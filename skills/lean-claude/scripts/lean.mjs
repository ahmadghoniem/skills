#!/usr/bin/env node
// Measures what Claude Code sends on every request, per component, and joins it with
// how often each component was actually used in local transcripts.
//
//   node lean.mjs report [--days N] [--json <file>] [--estimate]
//   node lean.mjs stretch --saved N [--days N]
//
// Both read every transcript on disk unless --days narrows the window: Claude Code
// deletes old ones itself (cleanupPeriodDays), so whatever is left is the most data.
//   node lean.mjs capture [--out <file>] [--settings '<json>']
//
// Capturing costs nothing: Claude Code is pointed at a local server that records the
// first request and answers with an error. Token counts come from Anthropic's
// count_tokens endpoint, which is free and runs no model, called with the login
// Claude Code itself sent. --estimate, or a failed call, falls back to 3.5 characters
// per token.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHARS_PER_TOKEN = 3.5;
const CORE_TOOLS = new Set(['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill', 'ToolSearch']);
// Loaded by headless runs only; interactive sessions never send it.
const HEADLESS_ONLY = new Set(['WaitForMcpServers']);
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const API_BASE = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');

// ---------- capture ----------

// One command string: passing an argv array with shell:true is deprecated in Node 24.
function claudeCmd(settingsFile) {
  const q = (s) => (process.platform === 'win32' ? `"${s}"` : `'${s}'`);
  const a = ['claude', '-p', '--no-session-persistence'];
  if (settingsFile) a.push('--settings', q(settingsFile));
  a.push(q('say ok'));
  return a.join(' ');
}

// Headless runs leave Artifact out unless CLAUDE_CODE_ARTIFACT=1, while interactive
// sessions load it. The variable does not override enableArtifact: false or a deny.
export function capture({ env = {}, settings = null, cwd = process.cwd(), timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    let got = null;
    const srv = http.createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d)).on('end', () => {
        if (got === null && req.url.includes('/v1/messages') && !req.url.includes('count_tokens')) got = { body: b, headers: req.headers };
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'captured by lean-claude' } }));
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      let dir = null, settingsFile = null;
      if (settings) { dir = mkdtempSync(join(tmpdir(), 'lean-claude-')); settingsFile = join(dir, 'settings.json').replace(/\\/g, '/'); writeFileSync(settingsFile, JSON.stringify(settings)); }
      const childEnv = { ...process.env, CLAUDE_CODE_ARTIFACT: '1', ...env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${srv.address().port}` };
      const c = spawn(claudeCmd(settingsFile), { env: childEnv, cwd, shell: true, stdio: 'ignore' });
      const t = setTimeout(() => c.kill(), timeoutMs);
      const done = () => { clearTimeout(t); srv.close(); if (dir) rmSync(dir, { recursive: true, force: true }); };
      c.on('error', (e) => { done(); reject(e); });
      c.on('exit', () => {
        done();
        if (got === null) reject(new Error('Claude Code sent no request (is `claude` on PATH and logged in?)'));
        else resolve({ req: JSON.parse(got.body), headers: got.headers });
      });
    });
  });
}

// ---------- counting ----------

function counter(headers, estimate) {
  const pick = ['authorization', 'x-api-key', 'anthropic-beta', 'anthropic-version', 'user-agent', 'x-app'];
  const h = { 'content-type': 'application/json' };
  for (const k of pick) if (headers[k]) h[k] = headers[k];
  const exact = !estimate && Boolean(h.authorization || h['x-api-key']);
  // Returns null when the call fails, so the caller can fall back for that one item
  // without mixing exact and estimated totals.
  const count = async (req) => {
    if (!exact) return null;
    const body = { model: req.model, messages: req.messages };
    if (req.system?.length) body.system = req.system;
    if (req.tools?.length) body.tools = req.tools;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`${API_BASE}/v1/messages/count_tokens?beta=true`, { method: 'POST', headers: h, body: JSON.stringify(body) });
        if (res.ok) return (await res.json()).input_tokens;
        if (res.status !== 429 && res.status < 500) { process.stderr.write(`lean-claude: count_tokens ${res.status}: ${(await res.text()).slice(0, 200)}\n`); return null; }
      } catch (e) { if (attempt >= 2) { process.stderr.write(`lean-claude: count_tokens failed (${e.message})\n`); return null; } }
      if (attempt >= 2) return null;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  };
  return { count, exact };
}

const reqChars = (req) => size({ s: req.system, t: req.tools, m: req.messages });

async function pool(tasks, n = 6) {
  const out = new Array(tasks.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}

// ---------- breakdown ----------

const size = (x) => JSON.stringify(x ?? null).length;

function splitBy(text, re) {
  const parts = []; let cur = null;
  for (const line of text.split('\n')) {
    const m = re.exec(line);
    if (m) { cur = { name: m[1].trim(), text: line }; parts.push(cur); } else if (cur) cur.text += '\n' + line;
  }
  return parts;
}

// A copy of the request with one piece of text taken out of one system or message block.
// The API rejects empty text blocks, so a block left empty is dropped (system) or
// replaced by a one-character placeholder (messages).
function withoutText(req, loc, text) {
  const r = structuredClone(req);
  if (loc.sys) {
    r.system[loc.b].text = r.system[loc.b].text.replace(text, '');
    r.system = r.system.filter((b) => b.text?.trim());
    return r;
  }
  const msg = r.messages[loc.m];
  if (typeof msg.content === 'string') msg.content = msg.content.replace(text, '').trim() ? msg.content.replace(text, '') : '.';
  else {
    const b = msg.content[loc.b];
    b.text = b.text.replace(text, '');
    if (!b.text.trim()) { b.text = '.'; delete b.cache_control; }
  }
  return r;
}

function classify(text, loc, add) {
  const body = text.replace(/^<system-reminder>\n?/, '').replace(/<\/system-reminder>\s*$/, '');
  const each = (kind, parts) => { for (const p of parts) add(kind, p.name, p.text, loc); };
  if (body.includes('Codebase and user instructions')) each('instructions', splitBy(body, /^Contents of (.+?) \(/));
  else if (body.startsWith('The following skills are available')) each('skill', splitBy(body, /^- (.+?):(?: |$)/));
  else if (body.startsWith('Available agent types')) each('agent', splitBy(body, /^- (.+?):(?: |$)/));
  else if (body.includes('# MCP Server Instructions')) each('mcp-instructions', splitBy(body, /^## (.+)$/));
  else if (/deferred tools/i.test(body.slice(0, 200))) add('deferred-tool-list', 'names of deferred tools', text, loc);
  else {
    const head = (body.match(/^#+ (.+)$/m)?.[1] ?? body.split('\n').find((l) => l.trim()) ?? '').slice(0, 60);
    add('reminder', head, text, loc);
  }
}

export function breakdown(req) {
  const items = [];
  const add = (kind, name, text, loc) => items.push({ kind, name, chars: text.length, cut: (r) => withoutText(r, loc, text) });
  (req.system ?? []).forEach((s, b) => {
    const text = typeof s === 'string' ? s : s.text ?? '';
    const loc = { sys: true, b };
    const sections = splitBy(text, /^# (.+)$/);
    if (sections.length < 2) { add('system-prompt', b === 0 ? 'header' : `block ${b}`, text, loc); return; }
    const pre = text.slice(0, text.indexOf(sections[0].text));
    if (pre.trim()) add('system-prompt', 'preamble', pre, loc);
    for (const p of sections) add('system-prompt', p.name, p.text, loc);
  });
  for (const t of req.tools ?? []) {
    const m = /^mcp__(.+?)__/.exec(t.name ?? '');
    items.push({ kind: m ? 'mcp-tool' : 'tool', name: t.name ?? t.type, chars: size(t), cut: (r) => ({ ...r, tools: r.tools.filter((x) => x.name !== t.name) }) });
  }
  (req.messages ?? []).forEach((msg, m) => {
    const blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];
    blocks.forEach((bl, b) => {
      if (bl.type !== 'text' || !bl.text) return;
      const loc = { m, b };
      if (msg.role === 'system') {
        // Newer versions send the listings as one system-role message without reminder tags.
        for (const p of splitBy(bl.text, /^(# [^#].*|Available agent types.*|The following skills are available.*)$/)) classify(p.text, loc, add);
      } else {
        for (const r of bl.text.match(/<system-reminder>[\s\S]*?<\/system-reminder>/g) ?? []) classify(r, loc, add);
      }
    });
  });
  return items;
}

// ---------- usage ----------

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f); const s = statSync(p);
    if (s.isDirectory()) yield* walk(p); else if (f.endsWith('.jsonl')) yield { p, mtime: s.mtimeMs };
  }
}

// A subagent's transcript sits in <session>/subagents/ and counts toward its parent.
const sessionOf = (p) => (basename(dirname(p)) === 'subagents' ? basename(dirname(dirname(p))) : basename(p, '.jsonl'));

export async function usage(days) {
  const cutoff = Date.now() - days * 864e5;
  const u = { tool: {}, skill: {}, typed: {}, agent: {}, mcp: {}, sessions: 0, sessionIds: new Set(), headlessIds: new Set(), deferred: new Set(), deferredAt: 0, from: null };
  // Each item keeps the interactive sessions it was used in: 41 calls in one session and
  // one call in each of 41 sessions argue differently for keeping it. Headless runs
  // (`claude -p`, the SDK) are counted apart: a script that needs a tool still needs it.
  const bump = (m, k, ts, sid, headless) => {
    const e = (m[k] ??= { n: 0, last: '', s: new Set(), headless: 0 });
    e.n++; if (headless) e.headless++; else e.s.add(sid);
    if (ts > e.last) e.last = ts;
  };
  const root = join(CLAUDE_DIR, 'projects');
  if (!existsSync(root)) return u;
  for (const { p, mtime } of walk(root)) {
    if (mtime < cutoff) continue;
    u.sessions++;
    const sid = sessionOf(p);
    for await (const line of createInterface({ input: createReadStream(p) })) {
      if (!line.includes('tool_use') && !line.includes('command-name') && !line.includes('deferred_tools_delta')) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const ts = String(e.timestamp ?? '').slice(0, 10);
      if (ts && Date.parse(ts) < cutoff) continue;
      const headless = String(e.entrypoint ?? '').startsWith('sdk');
      (headless ? u.headlessIds : u.sessionIds).add(sid);
      if (ts && (!u.from || ts < u.from)) u.from = ts;
      if (e.attachment?.type === 'deferred_tools_delta' && Date.parse(e.timestamp) > u.deferredAt) {
        u.deferredAt = Date.parse(e.timestamp); u.deferred = new Set(e.attachment.addedNames ?? []);
      }
      const content = e.message?.content;
      const typed = (s) => { for (const m of s.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) bump(u.typed, m[1], ts, sid, headless); };
      if (typeof content === 'string') { typed(content); continue; }
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type === 'text' && b.text?.includes('<command-name>')) typed(b.text);
        if (b.type !== 'tool_use') continue;
        bump(u.tool, b.name, ts, sid, headless);
        if (b.name === 'Skill' && b.input?.skill) bump(u.skill, b.input.skill, ts, sid, headless);
        if (b.name === 'Agent' || b.name === 'Task') bump(u.agent, b.input?.subagent_type || 'general-purpose', ts, sid, headless);
        const m = /^mcp__(.+?)__/.exec(b.name); if (m) bump(u.mcp, m[1], ts, sid, headless);
      }
    }
  }
  return u;
}

// ---------- usage limit ----------
// How much further the usage limit goes once `saved` tokens leave every request.
// Replays the transcripts in the window: each API call either read its prefix from
// the prompt cache or wrote it, and the saved tokens would have been read or written
// the same way. Anthropic doesn't publish how plan limits weigh token kinds, so the
// share is computed three ways: at API prices (input 1, cache write 1.25 or 2, cache
// read 0.1, output 5), with cache reads free, and with cache reads at full price.

const WEIGHTS = { price: 0.1, readsFree: 0, readsFull: 1 };
const SUGGESTION_GATE = 1e4; // the CLI skips a suggestion when the turn wrote more than this
const PATCH_RULE_TOKENS = 130; // the rule a batch-edit tool needs, loaded on every request

export async function stretch(saved, days = Infinity) {
  const cutoff = Date.now() - days * 864e5;
  const root = join(CLAUDE_DIR, 'projects');
  const seen = new Set();
  const total = { price: 0, readsFree: 0, readsFull: 0 }, cut = { ...total };
  let calls = 0, suggestions = 0, suggestionCost = 0, ruleUnit = 0, w1All = 0, w5All = 0, first = Infinity, last = 0;
  const misses = [], active = {}, titles = {}, compacted = [];
  if (!existsSync(root)) return null;
  for (const { p, mtime } of walk(root)) {
    if (mtime < cutoff) continue;
    let replies = 0, prev = null, compactAt = 0;
    const sid = sessionOf(p);
    for await (const line of createInterface({ input: createReadStream(p) })) {
      if (!line.includes('"usage"') && !line.includes('compact_boundary') && !line.includes('"ai-title"')) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.type === 'ai-title') { titles[sid] = e.aiTitle; continue; }
      if (e.subtype === 'compact_boundary') {
        compactAt = Date.parse(e.timestamp);
        if (compactAt >= cutoff && e.compactMetadata?.postTokens) compacted.push(e.compactMetadata.postTokens);
        continue;
      }
      const m = e.message, u = m?.usage;
      // <synthetic> entries are placeholders Claude Code writes for errors, not requests.
      if (e.type !== 'assistant' || !u || m.model === '<synthetic>' || seen.has(m.id) || Date.parse(e.timestamp) < cutoff) continue;
      seen.add(m.id);
      const cc = u.cache_creation ?? {};
      const w1 = cc.ephemeral_1h_input_tokens ?? (u.cache_creation ? 0 : u.cache_creation_input_tokens ?? 0);
      const w5 = cc.ephemeral_5m_input_tokens ?? 0;
      const read = u.cache_read_input_tokens ?? 0;
      const input = u.input_tokens ?? 0, output = u.output_tokens ?? 0, written = u.cache_creation_input_tokens ?? 0;
      // The removed tokens sit at the front of the prompt, so the cache read covers them
      // first, then the cache write, then plain input. A request smaller than the cut
      // (a side request, a small subagent) only ever carried what it carried.
      const fromRead = Math.min(saved, read), fromWrite = Math.min(saved - fromRead, written);
      const fromInput = Math.min(saved - fromRead - fromWrite, input);
      const writeRate = written ? (1.25 * w5 + 2 * w1) / written : 2;
      for (const [k, r] of Object.entries(WEIGHTS)) {
        total[k] += input + 1.25 * w5 + 2 * w1 + r * read + 5 * output;
        cut[k] += r * fromRead + writeRate * fromWrite + fromInput;
      }
      ruleUnit += read >= PATCH_RULE_TOKENS ? 0.1 : 2;
      w1All += w1; w5All += w5;
      calls++;
      const t = Date.parse(e.timestamp);
      if (t < first) first = t;
      if (t > last) last = t;
      (active[sid] ??= []).push(t);
      if (e.isSidechain) continue;
      // The conversation was written to the cache again instead of read from it. Kept
      // when the gap outlasts the cache lifetime, which is known only after the loop.
      if (prev && t - prev.t > 3e5 && t - compactAt > 3e5 && written > 5000 && read < 0.5 * prev.ctx) {
        const tokens = Math.min(written, prev.ctx), rate = (1.25 * w5 + 2 * w1) / written;
        misses.push({ sid, from: prev.t, to: t, tokens, rate, ctx: prev.ctx, project: basename(e.cwd ?? '') });
      }
      prev = { t, ctx: input + written + read + output };
      replies++;
      // A prompt suggestion runs after a turn ends, from the third reply on, and only
      // when the turn left the cache warm. It reads the whole context from cache and
      // writes nothing. The CLI doesn't log them, so this is an upper bound: it also
      // counts turns that ended while the terminal was unfocused.
      if (m.stop_reason === 'end_turn' && replies >= 2 && input + output + written <= SUGGESTION_GATE) {
        suggestions++;
        suggestionCost += input + written + read;
      }
    }
  }
  if (!total.price) return null;
  // Suggestions only run while the server-side flag is on for this account.
  let flag = null;
  try {
    const cfg = JSON.parse(readFileSync(process.env.CLAUDE_CONFIG_DIR ? join(CLAUDE_DIR, '.claude.json') : join(homedir(), '.claude.json'), 'utf8'));
    flag = cfg.cachedGrowthBookFeatures?.tengu_chomp_inflection ?? null;
  } catch {}
  const pct = (k) => cut[k] / total[k];
  // Returns after the cache expired. Cost is the write minus the cached read it
  // replaced. Compacting first would have read the conversation while it was still
  // cached, written a summary, and written only that summary again on return.
  const ttl = w1All >= w5All ? 36e5 : 3e5;
  const back = misses.filter((x) => x.to - x.from > ttl);
  const sorted = [...compacted].sort((a, b) => a - b), summary = sorted[sorted.length >> 1] ?? 15000;
  const times = Object.entries(active);
  for (const x of back) x.elsewhere = times.some(([s, ts]) => s !== x.sid && ts.some((v) => v > x.from && v < x.to));
  const extra = (x) => x.tokens * (x.rate - 0.1), sum = (f, l = back) => l.reduce((a, x) => a + f(x), 0);
  const sizes = back.map((x) => x.tokens).sort((a, b) => a - b);
  // Five-minute writes that expired within the hour: `promptCacheTtl: "1h"` would have
  // read them instead, at the price of every 5-minute write costing 2 instead of 1.25.
  const shortGaps = misses.filter((x) => x.rate < 1.5 && x.to - x.from <= 36e5);
  const oneHourNet = sum((x) => x.tokens * (x.rate - 0.1), shortGaps) - 0.75 * w5All;
  const further = (k) => total[k] / (total[k] - Math.min(cut[k], total[k] * 0.99)) - 1;
  return {
    from: new Date(first).toISOString().slice(0, 10), spanDays: Math.max(1, Math.round((last - first) / 864e5)),
    calls, suggestions, suggestionsServerOn: flag,
    share: pct('price'), stretch: further('price') + 1,
    range: Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, { share: pct(k), further: further(k) }])),
    suggestionShareMax: (0.1 * suggestionCost) / total.price,
    cacheExpiry: {
      ttlMinutes: ttl / 6e4, returns: back.length, sessions: new Set(back.map((x) => x.sid)).size,
      afterOtherSession: back.filter((x) => x.elsewhere).length, medianTokens: sizes[sizes.length >> 1] ?? 0,
      share: sum(extra) / total.price, shareAfterOtherSession: sum(extra, back.filter((x) => x.elsewhere)) / total.price,
      summaryTokens: summary,
      oneHourTtl: { returns: shortGaps.length, share: oneHourNet / total.price },
      compactFirstShare: sum((x) => Math.max(0, x.tokens * x.rate - 0.1 * x.ctx - 7 * summary)) / total.price,
      largest: [...back].sort((a, b) => extra(b) - extra(a)).slice(0, 3).map((x) => ({
        title: titles[x.sid] ?? null, project: x.project, date: new Date(x.to).toISOString().slice(0, 10),
        gapHours: +((x.to - x.from) / 36e5).toFixed(1), tokens: x.tokens, afterOtherSession: x.elsewhere,
      })),
    },
    editScripts: await editScripts(cutoff, total.price, PATCH_RULE_TOKENS * ruleUnit),
  };
}

// ---------- hand-written edit scripts ----------
// Python and Node scripts Claude writes to make literal replacements
// (`s.replace(old, new)` then a write), which apply-patch does with a check first.
// A failed script stays in context with its error, and so does the retry; the
// script's own boilerplate (imports, reads, writes, asserts) is carried the same way.
// `share` is what both would have cost, net of the rule that points Claude at
// apply-patch, as a share of usage at API prices.

const SCRIPT = /\b(python3?|py|node)\b[^\n]*(<<|-c\s|-e\s)/;
const WRITES = /write_text\(|writeFileSync\(|\.write\(|open\([^)]*['"]w/;
const LITERAL = /\.replace\(\s*(?:[rbu]?'|[rbu]?"|`|old|a\b|s\b|find|search|before)/;
const REGEX = /re\.sub\(|re\.compile|\.replace\(\s*\/|replaceAll\(\s*\//;
const EXITED = /Exit code [1-9]/;
const SCRIPT_ERROR = /Traceback|AssertionError|SyntaxError|syntax error|unexpected EOF/;
const OTHER_ERROR = /Error:|not found|NOT FOUND|no match/;
// Failures that aren't the script's: no interpreter, or a test or build chained after it.
const NO_INTERPRETER = /Python was not found|command not found|is not recognized/;
const CHAINED = /(&&|;|\|\|)\s*(npm|pnpm|yarn|bun|npx|pytest|tsc|git|cargo|make|node --test)\b/;
const failedScript = (cmd, res, out) => {
  if (!res || NO_INTERPRETER.test(out)) return false;
  if (SCRIPT_ERROR.test(out)) return true;
  return (res.is_error === true || EXITED.test(out)) && OTHER_ERROR.test(out) && !CHAINED.test(cmd.split('\n').slice(-3).join('\n'));
};
const literals = (s) => [...s.matchAll(/"""[\s\S]*?"""|'''[\s\S]*?'''|`(?:\\[\s\S]|[^`])*`|"(?:\\.|[^"\n])*"|'(?:\\.|[^'\n])*'/g)]
  .reduce((a, m) => a + (m[0].length >= 20 ? m[0].length : 0), 0);

async function editScripts(cutoff, total, ruleCost) {
  const r = { scripts: 0, replacements: 0, failed: 0, edits: 0, editsFailed: 0, patches: 0 };
  let cost = 0;
  for (const { p, mtime } of walk(join(CLAUDE_DIR, 'projects'))) {
    if (mtime < cutoff) continue;
    const ev = [], seen = new Set(), results = new Map(), calls = [];
    for await (const line of createInterface({ input: createReadStream(p) })) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      const t = Date.parse(e.timestamp);
      if (!(t >= cutoff)) continue;
      const m = e.message;
      if (e.type === 'assistant' && m?.usage && !seen.has(m.id)) { seen.add(m.id); calls.push(t); }
      for (const b of Array.isArray(m?.content) ? m.content : []) {
        if (b.type === 'tool_result') results.set(b.tool_use_id, b);
        if (b.type === 'tool_use') ev.push({ t, b });
      }
    }
    for (const { t, b } of ev) {
      const res = results.get(b.id);
      const out = res ? (typeof res.content === 'string' ? res.content : JSON.stringify(res.content ?? '')).slice(0, 3000) : '';
      if (b.name === 'Edit') { r.edits++; if (res?.is_error) r.editsFailed++; continue; }
      const cmd = ['Bash', 'PowerShell'].includes(b.name) ? String(b.input?.command ?? '') : '';
      if (/apply-patch/.test(cmd)) { r.patches++; continue; }
      if (!SCRIPT.test(cmd) || !WRITES.test(cmd) || !LITERAL.test(cmd) || REGEX.test(cmd)) continue;
      r.scripts++;
      // Each replace() is an edit the Edit tool would have taken one call for.
      r.replacements += cmd.split('.replace(').length - 1;
      // written once as output, cached, then read on every later request
      const later = calls.filter((x) => x > t).length, carry = (tok) => 7 * tok + 0.1 * tok * later;
      cost += carry(Math.max(0, cmd.length - literals(cmd) - 120) / CHARS_PER_TOKEN);
      if (failedScript(cmd, res, out)) { r.failed++; cost += carry((cmd.length + out.length) / CHARS_PER_TOKEN); }
    }
  }
  return { ...r, share: Math.max(0, cost - ruleCost) / total };
}

// ---------- claude.ai skills ----------
// Synced skills arrive while a session starts, often after the first request, so a
// capture can miss them. Size their listing lines from the synced folder instead.

function syncedSkills() {
  const root = join(CLAUDE_DIR, 'skills', 'synced');
  const out = [];
  if (!existsSync(root)) return out;
  for (const acct of readdirSync(root)) {
    const dir = join(root, acct);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      const f = join(dir, name, 'SKILL.md');
      if (name.startsWith('.') || !existsSync(f)) continue;
      const head = readFileSync(f, 'utf8').split('\n---')[0];
      // One-line or block (`>` / `|`) YAML description.
      const m = /^description:[ \t]*(.*)$((?:\n[ \t]+.*)*)/m.exec(head);
      const desc = (/^[>|]/.test(m?.[1] ?? '') ? m[2] : m?.[1] ?? '').replace(/\s+/g, ' ').trim().replace(/^['"]|['"]$/g, '');
      out.push({ name, line: `- ${name}: ${desc}` });
    }
  }
  return out;
}

// ---------- switches ----------
// Env switches go through --settings: settings.json `env` overrides the process
// environment. `patch` turns the switch on, `revert` measures what turning it back
// off would cost; `applies` says whether it can do anything on this setup.

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } }
const userSettings = () => readJson(join(CLAUDE_DIR, 'settings.json'));
const claudeJson = () => readJson(process.env.CLAUDE_CONFIG_DIR ? join(CLAUDE_DIR, '.claude.json') : join(homedir(), '.claude.json')) ?? {};
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');

// MCP servers set to `alwaysLoad: true` send every tool schema on every request instead
// of waiting behind tool search. User and local scope live in ~/.claude.json, project
// scope in .mcp.json.
function alwaysLoadServers(cwd) {
  const cfg = claudeJson();
  const here = resolve(cwd).toLowerCase();
  const local = Object.entries(cfg.projects ?? {}).find(([k]) => resolve(k).toLowerCase() === here)?.[1]?.mcpServers;
  const scopes = { user: cfg.mcpServers, local, project: readJson(join(cwd, '.mcp.json'))?.mcpServers };
  return Object.entries(scopes).flatMap(([scope, servers]) => Object.entries(servers ?? {})
    .filter(([, v]) => v?.alwaysLoad === true).map(([name]) => ({ name, scope, prefix: `mcp__${name.replace(/[^a-zA-Z0-9_-]/g, '_')}__` })));
}
const envOn = (s, k, v = '1') => s.env?.[k] === v;
const has = (req, re) => (req.tools ?? []).some((t) => re.test(t.name ?? ''));

const SWITCHES = [
  { id: 'artifact', name: 'Artifact off', how: 'settings enableArtifact: false', on: (s) => s.enableArtifact === false || s.disableArtifact === true, applies: (req) => has(req, /^Artifact/), patch: { enableArtifact: false }, tools: /^Artifact/ },
  { id: 'simple-prompt', name: 'Short system prompt', how: 'env CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1', on: (s) => envOn(s, 'CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT'), applies: () => true, patch: { env: { CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '1' } }, revert: { env: { CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '0' } }, unset: { env: { CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '' } } },
  { id: 'git', name: 'Built-in git instructions off', how: 'settings includeGitInstructions: false', on: (s) => s.includeGitInstructions === false, applies: (req) => has(req, /^Bash$/), patch: { includeGitInstructions: false }, revert: { includeGitInstructions: true } },
  { id: 'powershell', name: 'PowerShell tool off (Windows)', how: 'env CLAUDE_CODE_USE_POWERSHELL_TOOL=0', on: (s) => envOn(s, 'CLAUDE_CODE_USE_POWERSHELL_TOOL', '0'), applies: (req) => process.platform === 'win32' && has(req, /^PowerShell$/), patch: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: '0' } }, tools: /^PowerShell$/, windows: true },
  { id: 'cron', name: 'Cron tools off (/loop stops working)', how: 'env CLAUDE_CODE_DISABLE_CRON=1', on: (s) => envOn(s, 'CLAUDE_CODE_DISABLE_CRON'), applies: (req) => has(req, /^Cron/), patch: { env: { CLAUDE_CODE_DISABLE_CRON: '1' } }, tools: /^Cron/ },
  { id: 'claude-ai-skills', name: 'claude.ai skill sync off', how: 'settings syncClaudeAiSkills: false', on: (s) => s.syncClaudeAiSkills === false, applies: () => true, patch: { syncClaudeAiSkills: false }, revert: { syncClaudeAiSkills: true } },
  { id: 'claude-ai-connectors', name: 'claude.ai connectors off', how: 'settings disableClaudeAiConnectors: true', on: (s) => s.disableClaudeAiConnectors === true, applies: (req) => has(req, /^mcp__claude_ai_/), patch: { disableClaudeAiConnectors: true } },
  { id: 'explore-plan', name: 'Explore/Plan agents off', how: 'env CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1', on: (s) => envOn(s, 'CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS'), applies: (req) => has(req, /^Agent$/), patch: { env: { CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS: '1' } }, revert: { env: { CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS: '0' } } },
];

// Side requests that re-send the whole conversation. The probe cannot see them.
const UNMEASURED = [
  { id: 'recap', name: 'Session recap off', how: 'settings awaySummaryEnabled: false', on: (s) => s.awaySummaryEnabled === false },
  { id: 'suggestions', name: 'Prompt suggestions off', how: 'settings promptSuggestionEnabled: false', on: (s) => s.promptSuggestionEnabled === false },
];

// Built-in tools this setup does not load, sized from a capture with an empty config
// (a placeholder API key; the request never leaves the machine). Only the prompt
// switch is carried over, since it changes tool descriptions; the variables that
// remove tools are forced back to their defaults, including copies a Claude Code
// shell inherits from the user's settings.
async function referenceTools(s) {
  const dir = mkdtempSync(join(tmpdir(), 'lean-claude-ref-'));
  const env = { CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: s.env?.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT ?? '0', CLAUDE_CODE_USE_POWERSHELL_TOOL: process.platform === 'win32' ? '1' : '0', CLAUDE_CODE_DISABLE_CRON: '0' };
  try {
    const { req } = await capture({ env: { ...env, CLAUDE_CONFIG_DIR: dir, ANTHROPIC_API_KEY: 'sk-ant-lean-claude-probe' }, settings: { env }, cwd: dir });
    return req.tools ?? [];
  } catch { return []; } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------- report ----------

const pluginOf = (kind, name) => {
  if (kind === 'mcp-tool') return /^mcp__plugin_([^_]+)_/.exec(name)?.[1] ?? null;
  return (kind === 'skill' || kind === 'agent') && name.includes(':') ? name.split(':')[0] : null;
};

async function report({ days = Infinity, json = null, estimate = false }) {
  const s = userSettings();
  const base = await capture();
  const counting = counter(base.headers, estimate);
  const exactTotal = await counting.count(base.req);
  const exact = exactTotal !== null;
  const total = exactTotal ?? Math.round(reqChars(base.req) / CHARS_PER_TOKEN);
  const ratio = total / reqChars(base.req);
  // Exact when every call succeeds; any failed call is estimated from the same ratio.
  const count = async (req) => (exact ? await counting.count(req) : null) ?? Math.round(reqChars(req) * ratio);
  const items = breakdown(base.req);
  const u = await usage(days);
  // Claude Code's own counters, kept since install: they outlive deleted transcripts.
  const { skillUsage = {}, pluginUsage = {} } = claudeJson();

  const tokens = await pool(items.map((i) => async () => Math.max(0, total - (await count(i.cut(base.req))))));
  const rows = items.map((i, k) => {
    const r = { kind: i.kind, name: i.name, chars: i.chars, tokens: tokens[k] };
    // A skill is used by the model (Skill tool) or typed by the user (/name); the two
    // counts decide between turning it off and hiding it from the model only.
    const sk = (m) => m[i.name] ?? m[i.name.split(':').pop()];
    const use = i.kind === 'tool' || i.kind === 'mcp-tool' ? u.tool[i.name] : i.kind === 'agent' ? u.agent[i.name] : null;
    if (i.kind === 'skill') {
      const [a, b] = [sk(u.skill), sk(u.typed)];
      Object.assign(r, { modelUses: a?.n ?? 0, typed: b?.n ?? 0, uses: (a?.n ?? 0) + (b?.n ?? 0), sessions: new Set([...(a?.s ?? []), ...(b?.s ?? [])]).size, last: [a?.last ?? '', b?.last ?? ''].sort().pop() });
      const life = skillUsage[i.name] ?? skillUsage[i.name.split(':').pop()];
      Object.assign(r, { lifetimeUses: life?.usageCount ?? 0, lifetimeLast: day(life?.lastUsedAt) });
    } else if (['tool', 'mcp-tool', 'agent'].includes(i.kind)) { r.uses = use?.n ?? 0; r.sessions = use?.s.size ?? 0; r.headlessUses = use?.headless ?? 0; r.last = use?.last ?? ''; }
    if (i.kind === 'agent') r.userFile = existsSync(join(CLAUDE_DIR, 'agents', `${i.name}.md`));
    if (i.kind === 'mcp-instructions') r.uses = Object.entries(u.mcp).filter(([k]) => k.includes(i.name.replace(/\W+/g, '_'))).reduce((a, [, v]) => a + v.n, 0);
    if (i.kind === 'tool' || i.kind === 'mcp-tool') { r.deferred = u.deferred.has(i.name); r.core = CORE_TOOLS.has(i.name); r.headlessOnly = HEADLESS_ONLY.has(i.name); }
    r.plugin = pluginOf(i.kind, i.name);
    return r;
  });

  // Plugins: everything a plugin adds, and whether any of it was used.
  const keys = Object.keys(s.enabledPlugins ?? {});
  const plugins = {};
  for (const r of rows.filter((x) => x.plugin)) {
    const p = (plugins[r.plugin] ??= { name: r.plugin, key: keys.find((k) => k.split('@')[0] === r.plugin) ?? r.plugin, tokens: 0, uses: 0, last: '', parts: 0 });
    p.tokens += r.tokens; p.uses += r.uses ?? 0; p.parts++; if ((r.last ?? '') > p.last) p.last = r.last;
  }
  // A plugin's lastUsedAt is set on install and on every enable, so it means use only
  // when the count is above zero.
  for (const p of Object.values(plugins)) {
    const life = pluginUsage[p.key];
    Object.assign(p, { lifetimeUses: life?.usageCount ?? 0, lifetimeLast: life?.usageCount ? day(life.lastUsedAt) : '' });
  }

  const variants = SWITCHES.map((w) => ({ ...w, isOn: w.on(s) }));
  // MCP servers connect at unpredictable moments, so two captures can differ by a whole
  // server. Switch deltas compare both captures with MCP tools and instructions removed,
  // except the connectors switch, whose saving is exactly those.
  const noMcp = (req) => breakdown(req).filter((i) => i.kind === 'mcp-instructions').reduce((r, i) => i.cut(r), { ...req, tools: (req.tools ?? []).filter((t) => !/^mcp__/.test(t.name)) });
  const baseNoMcp = await count(noMcp(base.req));
  const delta = async (w, patch) => {
    const v = (await capture({ settings: patch })).req;
    return w.id === 'claude-ai-connectors' ? total - (await count(v)) : baseNoMcp - (await count(noMcp(v)));
  };
  // Claude Code picks the short prompt per model (current Opus by default, Sonnet and
  // Haiku not), so the setting may change nothing here: unset and set to 1 give the same
  // system prompt and built-in tools. Compared as text, since the git snapshot in the
  // messages can move between two captures. fullCost is what the full prompt adds, which
  // is roughly what the setting saves on a model that defaults to the full one.
  const fixed = (r) => JSON.stringify([r.system, (r.tools ?? []).filter((t) => !/^mcp__/.test(t.name))]);
  const byModel = async (w) => {
    if (!w.unset) return {};
    const [unset, set] = await Promise.all([capture({ settings: w.unset }), capture({ settings: w.patch })]);
    const modelDefault = fixed(unset.req) === fixed(set.req);
    return { modelDefault, ...(modelDefault && { fullCost: -(await delta(w, w.revert)) }) };
  };
  const measured = await pool(variants.map((w) => async () => {
    if (!w.isOn && w.applies(base.req)) return { saves: await delta(w, w.patch), ...(await byModel(w)) };
    if (w.isOn && w.revert) {
      const c = -(await delta(w, w.revert));
      return { ...(c > 0 && { restoreCost: c }), ...(await byModel(w)) };
    }
    return {};
  }), 3);
  const switches = variants.filter((w, k) => w.isOn || w.applies(base.req)).map((w) => {
    const m = measured[variants.indexOf(w)];
    return { id: w.id, name: w.name, how: w.how, on: w.isOn, windowsOnly: Boolean(w.windows), ...m };
  });
  const synced = s.syncClaudeAiSkills === false ? [] : syncedSkills();
  if (synced.length) {
    const sys = { model: base.req.model, messages: [{ role: 'user', content: 'ok' }], system: [{ type: 'text', text: 'x' }] };
    const withLines = { ...sys, system: [{ type: 'text', text: 'x\n' + synced.map((k) => k.line).join('\n') }] };
    const fromFolder = (await count(withLines)) - (await count(sys));
    const w = switches.find((x) => x.id === 'claude-ai-skills');
    if (w) { w.saves = Math.max(w.saves ?? 0, fromFolder); w.skills = synced.map((k) => k.name); }
  }

  // Cost of bringing back a denied tool, measured one tool at a time.
  const denied = new Set((s.permissions?.deny ?? []).filter((d) => /^[\w-]+$/.test(d)));
  const loaded = new Set((base.req.tools ?? []).map((t) => t.name));
  const switchedOff = SWITCHES.filter((w) => w.tools && w.on(s)).map((w) => w.tools);
  const ref = (await referenceTools(s)).filter((t) => !loaded.has(t.name) && (denied.has(t.name) || switchedOff.some((re) => re.test(t.name))));
  // A request with any tools gets a fixed tool-use preamble, so each tool is measured
  // against a request that already has one small placeholder tool.
  const stub = { name: 'x', description: 'x', input_schema: { type: 'object', properties: {} } };
  const mini = { model: base.req.model, messages: [{ role: 'user', content: 'ok' }], tools: [stub] };
  const empty = await count(mini);
  const restore = (await pool(ref.map((t) => async () => ({ name: t.name, tokens: (await count({ ...mini, tools: [stub, t] })) - empty, denied: denied.has(t.name), switchedOff: switchedOff.some((re) => re.test(t.name)) })))).sort((a, b) => b.tokens - a.tokens);

  // Interactive sessions list deferred tools by name and load them when first used;
  // headless runs send every tool in full.
  const deferredRows = rows.filter((r) => r.deferred);
  const interactive = total - rows.filter((r) => r.headlessOnly).reduce((a, r) => a + r.tokens, 0)
    - deferredRows.reduce((a, r) => a + r.tokens, 0) + deferredRows.reduce((a, r) => a + Math.ceil((r.name.length + 1) / CHARS_PER_TOKEN), 0);

  const out = {
    version: base.headers['user-agent'] ?? '', model: base.req.model, counting: exact ? 'exact (count_tokens)' : `estimate (${CHARS_PER_TOKEN} chars/token)`,
    total, interactive, platform: process.platform, window: { days: Number.isFinite(days) ? days : null, from: u.from, sessions: u.sessionIds.size, headlessRuns: u.headlessIds.size, transcripts: u.sessions }, deferredKnown: u.deferred.size > 0,
    byKind: Object.entries(rows.reduce((a, r) => ((a[r.kind] = (a[r.kind] ?? 0) + r.tokens), a), {})).sort((a, b) => b[1] - a[1]),
    rows: rows.sort((a, b) => b.tokens - a.tokens),
    plugins: Object.values(plugins).sort((a, b) => b.tokens - a.tokens),
    alwaysLoad: alwaysLoadServers(process.cwd()).map(({ prefix, ...m }) => {
      const tools = rows.filter((r) => r.kind === 'mcp-tool' && r.name.startsWith(prefix));
      return { ...m, tools: tools.length, tokens: tools.reduce((a, r) => a + r.tokens, 0), uses: tools.reduce((a, r) => a + (r.uses ?? 0), 0) };
    }),
    switches, unmeasured: UNMEASURED.map((w) => ({ id: w.id, name: w.name, how: w.how, on: w.on(s) })),
    restore, skillOverrides: s.skillOverrides ?? {},
  };
  if (json) writeFileSync(json, JSON.stringify(out, null, 2));
  process.stdout.write(render(out));
}

function render(o) {
  const L = [];
  const n = (x) => (x ?? 0).toLocaleString('en-US');
  const used = (r) => `${r.uses ?? ''}${r.uses === 0 ? ' (unused)' : r.sessions ? ` in ${r.sessions} of ${o.window.sessions} sessions` : ''}${r.headlessUses ? `, ${r.headlessUses} headless` : ''}${r.lifetimeUses > (r.uses ?? 0) ? `, ${r.lifetimeUses} since install` : ''}`;
  L.push('# lean-claude report', '');
  L.push(`Every request starts with **${n(o.interactive)} tokens** in an interactive session, ${n(o.total)} in headless mode.`);
  L.push(`${o.counting}, model ${o.model}, ${o.version}. Usage: ${o.window.sessions} interactive sessions${o.window.headlessRuns ? ` and ${o.window.headlessRuns} headless runs` : ""}${o.window.from ? ` since ${o.window.from}` : ''}${o.window.days ? ` (--days ${o.window.days})` : ', every transcript on disk'}.`);
  if (!o.deferredKnown) L.push('No transcript showed which tools are deferred, so the interactive figure equals the headless one.');
  L.push('', '## Where the tokens go', '', '| Kind | Tokens |', '|---|---:|');
  for (const [k, t] of o.byKind) L.push(`| ${k} | ${n(t)} |`);
  L.push('', '## Switches', '', '| Switch | How | Status | Tokens |', '|---|---|---|---:|');
  for (const w of o.switches) {
    const status = (w.on ? 'on' : 'off') + (w.modelDefault ? ', already the default on this model' : '');
    const effect = w.modelDefault ? `none here; about −${n(w.fullCost)} on Sonnet or Haiku`
      : w.on ? (w.restoreCost != null ? `+${n(w.restoreCost)} to undo` : '') : `−${n(w.saves)}`;
    L.push(`| ${w.name} | \`${w.how}\` | ${status} | ${effect} |`);
  }
  for (const w of o.unmeasured) L.push(`| ${w.name} | \`${w.how}\` | ${w.on ? 'on' : 'off'} | not measurable |`);
  const cand = (r) => (r.kind === 'tool' || r.kind === 'mcp-tool' ? !r.core && !r.headlessOnly : ['skill', 'agent'].includes(r.kind)) && !r.plugin;
  const table = (title, list, note) => {
    if (!list.length) return;
    L.push('', `## ${title}`, '', ...(note ? [note, ''] : []), '| Kind | Name | Tokens | Uses | Last used |', '|---|---|---:|---:|---|');
    for (const r of list) L.push(`| ${r.kind} | ${r.name} | ${n(r.tokens)} | ${used(r)}${r.kind === 'skill' && r.uses ? ` (${r.typed} typed)` : ''} | ${r.last ?? ''} |`);
  };
  table('Always loaded', o.rows.filter((r) => cand(r) && !r.deferred));
  table('Deferred tools', o.rows.filter((r) => cand(r) && r.deferred), 'Interactive sessions list these by name and load them on first use.');
  if (o.plugins.length) {
    L.push('', '## Plugins', '', '| Plugin | Key | Tokens | Parts | Uses | Last used |', '|---|---|---:|---:|---:|---|');
    for (const p of o.plugins) L.push(`| ${p.name} | ${p.key} | ${n(p.tokens)} | ${p.parts} | ${used(p)} | ${p.last} |`);
  }
  if (o.alwaysLoad.length) {
    L.push('', '## MCP servers loaded in full', '', 'Set to `alwaysLoad: true`, so their tools skip tool search and go out in full on every request.', '', '| Server | Scope | Tools | Tokens | Uses |', '|---|---|---:|---:|---:|');
    for (const m of o.alwaysLoad) L.push(`| ${m.name} | ${m.scope} | ${m.tools} | ${n(m.tokens)} | ${m.uses} |`);
  }
  if (o.restore.length) {
    L.push('', '## Cost of turning back on', '', '| Tool | Tokens | Removed by |', '|---|---:|---|');
    for (const r of o.restore) L.push(`| ${r.name} | ${n(r.tokens)} | ${[r.denied && 'deny', r.switchedOff && 'switch'].filter(Boolean).join(', ')} |`);
  }
  L.push('', '## Other large items', '', '| Kind | Name | Tokens |', '|---|---|---:|');
  for (const r of o.rows.filter((x) => !cand(x) && !x.plugin && x.tokens >= 200)) L.push(`| ${r.kind} | ${r.name} | ${n(r.tokens)} |`);
  L.push('');
  return L.join('\n');
}

// ---------- cli ----------

function arg(args, name, dflt = null) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'report') {
    await report({ days: Number(arg(args, '--days', Infinity)), json: arg(args, '--json'), estimate: args.includes('--estimate') });
  } else if (cmd === 'stretch') {
    const r = await stretch(Number(arg(args, '--saved', 0)), Number(arg(args, '--days', Infinity)));
    process.stdout.write(r ? JSON.stringify(r, null, 1) + '\n' : 'no transcripts in the window\n');
  } else if (cmd === 'capture') {
    const settings = arg(args, '--settings'); const out = arg(args, '--out');
    const { req } = await capture({ settings: settings ? JSON.parse(settings) : null });
    if (out) writeFileSync(out, JSON.stringify(req));
    else process.stdout.write(JSON.stringify(breakdown(req).map(({ cut, ...i }) => i), null, 1) + '\n');
  } else {
    process.stdout.write('usage: lean.mjs report [--days N] [--json out.json] [--estimate] | stretch --saved N [--days N] | capture [--out f] [--settings json]\n');
    process.exitCode = cmd ? 2 : 0;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { process.stderr.write(`lean-claude: ${e.message}\n`); process.exitCode = 1; });
}
