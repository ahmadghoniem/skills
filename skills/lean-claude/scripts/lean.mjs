#!/usr/bin/env node
// Measures what Claude Code sends on every request, per component, and joins it with
// how often each component was actually used in local transcripts.
//
//   node lean.mjs report [--days N] [--json <file>] [--estimate]
//   node lean.mjs stretch --saved N [--days N]
//
// Both read every transcript on disk unless --days narrows the window: Claude Code
// deletes old ones itself (cleanupPeriodDays), so whatever is left is the most data.
//   node lean.mjs compare <before.json> <after.json>
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
const CORE_TOOLS = new Set(['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill', 'ToolSearch', 'Agent', 'SendMessage']);
// Loaded by headless runs only; interactive sessions never send it.
const HEADLESS_ONLY = new Set(['WaitForMcpServers']);
const BASH_GREP = /(^|&&|;|\n|\|\||\$\()\s*(grep|rg)\b/;
const BASH_FIND = /(^|&&|;|\n|\|\||\$\()\s*(find|fd)\b/;
const SEARCH_VIA_BASH = { Grep: 'Bash:grep', Glob: 'Bash:find' };
const BASH_SEARCH_RATIO = 10;
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
  // A skill over the listing budget appears as a bare "- name", with no colon.
  else if (body.startsWith('The following skills are available')) each('skill', splitBy(body, /^- ([\w.:/@-]+?)(?::(?: |$)|$)/));
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
  const add = (kind, name, text, loc) => items.push({ kind, name, chars: text.length, ...(kind === 'skill' && { listing: text.trim() }), cut: (r) => withoutText(r, loc, text) });
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
    // Each delta record lists what changed since the last one, so a session's deferred
    // set is replayed from all of them; the latest session's set wins.
    const deferred = new Set(); let deferredAt = 0;
    for await (const line of createInterface({ input: createReadStream(p) })) {
      if (!line.includes('tool_use') && !line.includes('command-name') && !line.includes('deferred_tools_delta')) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const ts = String(e.timestamp ?? '').slice(0, 10);
      if (ts && Date.parse(ts) < cutoff) continue;
      const headless = String(e.entrypoint ?? '').startsWith('sdk');
      (headless ? u.headlessIds : u.sessionIds).add(sid);
      if (ts && (!u.from || ts < u.from)) u.from = ts;
      if (e.attachment?.type === 'deferred_tools_delta') {
        const a = e.attachment;
        for (const n of [...(a.addedNames ?? []), ...(a.readdedNames ?? [])]) deferred.add(n);
        for (const n of a.removedNames ?? []) deferred.delete(n);
        deferredAt = Date.parse(e.timestamp);
      }
      const content = e.message?.content;
      const typed = (s) => { for (const m of s.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) bump(u.typed, m[1], ts, sid, headless); };
      if (typeof content === 'string') { typed(content); continue; }
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type === 'text' && b.text?.includes('<command-name>')) typed(b.text);
        if (b.type !== 'tool_use') continue;
        bump(u.tool, b.name, ts, sid, headless);
        // Searches Claude ran through Bash instead of Grep or Glob.
        if (b.name === 'Bash') {
          const cmd = String(b.input?.command ?? '');
          if (BASH_GREP.test(cmd)) bump(u.tool, 'Bash:grep', ts, sid, headless);
          if (BASH_FIND.test(cmd)) bump(u.tool, 'Bash:find', ts, sid, headless);
        }
        if (b.name === 'Skill' && b.input?.skill) bump(u.skill, b.input.skill, ts, sid, headless);
        if (b.name === 'Agent' || b.name === 'Task') bump(u.agent, b.input?.subagent_type || 'general-purpose', ts, sid, headless);
        const m = /^mcp__(.+?)__/.exec(b.name); if (m) bump(u.mcp, m[1], ts, sid, headless);
      }
    }
    if (deferred.size && deferredAt > u.deferredAt) { u.deferredAt = deferredAt; u.deferred = deferred; }
  }
  return u;
}

// ---------- usage limit ----------
// How much further the usage limit goes once `saved` tokens leave every request.
// Replays the transcripts in the window: each API call either read its prefix from
// the prompt cache or wrote it, and the saved tokens would have been read or written
// the same way. Anthropic doesn't publish how plan limits weigh token kinds, so the
// share is computed three ways: at API prices (input 1, cache write 1.25 or 2, cache
// read 0.1, or 0.05 on Opus 5.5, output 5), with cache reads free, and with cache
// reads at full price.

const cacheRead = (model) => (/opus-5-5/.test(model ?? '') ? 0.05 : 0.1);
const WEIGHTS = { price: cacheRead, readsFree: () => 0, readsFull: () => 1 };
const SUGGESTION_GATE = 1e4; // the CLI skips a suggestion when the turn wrote more than this
const PATCH_RULE_TOKENS = 130; // the rule a batch-edit tool needs, loaded on every request
const SHORT_DESC = 200; // characters a rewritten skill description is aimed at

export async function stretch(saved, days = Infinity) {
  const cutoff = Date.now() - days * 864e5;
  const root = join(CLAUDE_DIR, 'projects');
  const seen = new Map();
  const total = { price: 0, readsFree: 0, readsFull: 0 }, cut = { ...total };
  let calls = 0, suggestions = 0, suggestionCost = 0, ruleUnit = 0, w1All = 0, w5All = 0, first = Infinity, last = 0;
  let readTokens = 0, readCost = 0;
  const misses = [], active = {}, titles = {}, compacted = [];
  const convs = [], compactions = [], main = { calls: 0, written: 0, output: 0 };
  if (!existsSync(root)) return null;
  for (const { p, mtime } of walk(root)) {
    if (mtime < cutoff) continue;
    let replies = 0, prev = null, compactAt = 0;
    const sid = sessionOf(p), conv = [];
    convs.push(conv);
    for await (const line of createInterface({ input: createReadStream(p) })) {
      if (!line.includes('"usage"') && !line.includes('compact_boundary') && !line.includes('"ai-title"')) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.type === 'ai-title') { titles[sid] = e.aiTitle; continue; }
      if (e.subtype === 'compact_boundary') {
        compactAt = Date.parse(e.timestamp);
        const c = e.compactMetadata;
        if (compactAt >= cutoff && c?.postTokens) compacted.push(c.postTokens);
        if (compactAt >= cutoff && c?.preTokens) {
          compactions.push({ manual: c.trigger === 'manual', pre: c.preTokens, ms: c.durationMs ?? 0 });
          conv.push(null);
        }
        continue;
      }
      const m = e.message, u = m?.usage;
      // <synthetic> entries are placeholders Claude Code writes for errors, not requests.
      if (e.type !== 'assistant' || !u || m.model === '<synthetic>' || Date.parse(e.timestamp) < cutoff) continue;
      // A reply is logged as one line per content block, all under one id, and later
      // lines carry the output streamed since. Only that growth is added.
      if (seen.has(m.id)) {
        const grew = (u.output_tokens ?? 0) - seen.get(m.id);
        if (grew > 0) {
          for (const k of Object.keys(WEIGHTS)) total[k] += 5 * grew;
          seen.set(m.id, u.output_tokens);
          if (!e.isSidechain) main.output += grew;
        }
        continue;
      }
      seen.set(m.id, u.output_tokens ?? 0);
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
      for (const [k, w] of Object.entries(WEIGHTS)) {
        const r = w(m.model);
        total[k] += input + 1.25 * w5 + 2 * w1 + r * read + 5 * output;
        cut[k] += r * fromRead + writeRate * fromWrite + fromInput;
      }
      readTokens += read; readCost += cacheRead(m.model) * read;
      ruleUnit += read >= PATCH_RULE_TOKENS ? cacheRead(m.model) : 2;
      calls++;
      const t = Date.parse(e.timestamp);
      if (t < first) first = t;
      if (t > last) last = t;
      (active[sid] ??= []).push(t);
      if (e.isSidechain) continue;
      // Main conversation only: promptCacheTtl doesn't reach subagents, which default
      // to 5 minutes (subagentPromptCacheTtl).
      w1All += w1; w5All += w5;
      main.calls++; main.written += written; main.output += output;
      conv.push({ t, ctx: input + written + read, written });
      // The conversation was written to the cache again instead of read from it. Kept
      // when the gap outlasts the cache lifetime, which is known only after the loop.
      if (prev && t - prev.t > 3e5 && t - compactAt > 3e5 && written > 5000 && read < 0.5 * prev.ctx) {
        const tokens = Math.min(written, prev.ctx), rate = (1.25 * w5 + 2 * w1) / written;
        misses.push({ sid, from: prev.t, to: t, tokens, rate, ctx: prev.ctx, project: basename(e.cwd ?? '') });
      }
      prev = { t, ctx: input + written + read + output };
      replies++;
      // A prompt suggestion runs after a turn ends, once the conversation holds two
      // assistant messages, and only when the turn left the cache warm. It reads the
      // whole context from cache and writes nothing. The CLI doesn't log them, so this
      // is an upper bound: it also counts turns that ended while the terminal was
      // unfocused.
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
  // The cache-read rate across the window's models, for the estimates below.
  const readRate = readTokens ? readCost / readTokens : 0.1;
  // Returns after the cache expired. Cost is the write minus the cached read it
  // replaced. Compacting first would have read the conversation while it was still
  // cached, written a summary, and written only that summary again on return.
  const ttl = w1All >= w5All ? 36e5 : 3e5;
  const back = misses.filter((x) => x.to - x.from > ttl);
  const sorted = [...compacted].sort((a, b) => a - b), summary = sorted[sorted.length >> 1] ?? 15000;
  const times = Object.entries(active);
  for (const x of back) x.elsewhere = times.some(([s, ts]) => s !== x.sid && ts.some((v) => v > x.from && v < x.to));
  const extra = (x) => x.tokens * (x.rate - readRate), sum = (f, l = back) => l.reduce((a, x) => a + f(x), 0);
  const sizes = back.map((x) => x.tokens).sort((a, b) => a - b);
  // Five-minute writes that expired within the hour: `promptCacheTtl: "1h"` would have
  // read them instead, at the price of every 5-minute write costing 2 instead of 1.25.
  const shortGaps = misses.filter((x) => x.rate < 1.5 && x.to - x.from <= 36e5);
  const oneHourNet = sum((x) => x.tokens * (x.rate - readRate), shortGaps) - 0.75 * w5All;
  const further = (k) => total[k] / (total[k] - Math.min(cut[k], total[k] * 0.99)) - 1;
  return {
    from: new Date(first).toISOString().slice(0, 10), spanDays: Math.max(1, Math.round((last - first) / 864e5)),
    calls, suggestions, suggestionsServerOn: flag,
    share: pct('price'), stretch: further('price') + 1,
    range: Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, { share: pct(k), further: further(k) }])),
    suggestionShareMax: (readRate * suggestionCost) / total.price,
    cacheExpiry: {
      ttlMinutes: ttl / 6e4, returns: back.length, sessions: new Set(back.map((x) => x.sid)).size,
      afterOtherSession: back.filter((x) => x.elsewhere).length, medianTokens: sizes[sizes.length >> 1] ?? 0,
      share: sum(extra) / total.price, shareAfterOtherSession: sum(extra, back.filter((x) => x.elsewhere)) / total.price,
      summaryTokens: summary,
      oneHourTtl: { returns: shortGaps.length, share: oneHourNet / total.price },
      compactFirstShare: sum((x) => Math.max(0, x.tokens * x.rate - readRate * x.ctx - 7 * summary)) / total.price,
      largest: [...back].sort((a, b) => extra(b) - extra(a)).slice(0, 3).map((x) => ({
        title: titles[x.sid] ?? null, project: x.project, date: new Date(x.to).toISOString().slice(0, 10),
        gapHours: +((x.to - x.from) / 36e5).toFixed(1), tokens: x.tokens, afterOtherSession: x.elsewhere,
      })),
    },
    editScripts: await editScripts(cutoff, total.price, PATCH_RULE_TOKENS * ruleUnit, readRate),
    compaction: compactionPoint(convs, compactions, main, summary, w1All >= w5All ? 2 : 1.25, readRate, total.price),
  };
}

// ---------- compaction point ----------
// When to compact. Each session that reached the lowest option is replayed from that
// call to its last one, compacting whenever the context reaches K. A call costs a
// cache read of its context plus the writes and output every call has; a compaction
// reads the whole context once and writes the summary as output, and the call after
// it writes the new context to the cache. Context grows by the user's own mean per
// call, and faster in the 20 calls after a compaction, while files are read again.
// Prices are the same API weights as `stretch` (cache read 0.1 or 0.05, output 5).

const COMPACT_OPTIONS = [130e3, 165e3, 200e3];
const COMPACT_MARGIN = 13e3; // compaction fires this far below autoCompactWindow (2.1.283)
const REREAD_CALLS = 20;

function compactionPoint(convs, compactions, main, summary, writeRate, readRate, totalPrice) {
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const normal = [], reread = [], after = [], afterWrites = [], starts = [], runs = [];
  for (const conv of convs) {
    let prev = null, since = Infinity;
    for (const c of conv) {
      if (!c) { since = 0; prev = null; continue; }
      if (since === 0) { after.push(c.ctx); afterWrites.push(c.written); }
      if (prev && c.t - prev.t < 36e5 && c.ctx > prev.ctx && c.ctx - prev.ctx < 6e4) (since <= REREAD_CALLS ? reread : normal).push(c.ctx - prev.ctx);
      if (!prev && since === Infinity) starts.push(c.ctx);
      prev = c; since++;
    }
    const calls = conv.filter(Boolean), j = calls.findIndex((c) => c.ctx >= COMPACT_OPTIONS[0]);
    if (j >= 0) runs.push({ from: calls[j].ctx, n: calls.length - j - 1 });
  }
  if (runs.length < 5 || !normal.length) return null;
  const g = mean(normal), gAfter = reread.length ? mean(reread) : g;
  const base = after.length ? median(after) : summary + (starts.length ? median(starts) : 2e4);
  const perCompaction = 5 * summary + writeRate * (afterWrites.length ? median(afterWrites) : base / 2);
  const perCall = (writeRate * main.written + 5 * main.output) / main.calls;
  const sim = (from, n, at) => {
    let ctx = from, cost = 0, count = 0, since = Infinity;
    for (let i = 0; i < n; i++) {
      if (ctx >= at) { cost += readRate * ctx + perCompaction; ctx = base; count++; since = 0; }
      cost += readRate * ctx + perCall; ctx += since < REREAD_CALLS ? gAfter : g; since++;
    }
    return { cost, count };
  };
  const costAt = (at) => runs.reduce((a, r) => a + sim(r.from, r.n, at).cost, 0);

  // Where the user compacts now: by hand, if most compactions were, else the trigger
  // their window setting gives, else where automatic compaction fired.
  const s = userSettings(), env = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW ?? s.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  const window = Number(env ?? s.autoCompactWindow) || null;
  const manual = compactions.filter((c) => c.manual), auto = compactions.filter((c) => !c.manual);
  let current = null, source = null;
  if (manual.length >= 3 && manual.length >= auto.length) { current = median(manual.map((c) => c.pre)); source = 'manual'; }
  else if (window) { current = window - COMPACT_MARGIN; source = env != null ? 'env' : 'setting'; }
  else if (auto.length) { current = median(auto.map((c) => c.pre)); source = 'auto'; }

  const long = [...runs].sort((a, b) => a.n - b.n)[Math.floor(runs.length * 0.75)];
  const waitMs = compactions.length ? median(compactions.map((c) => c.ms)) : 0;
  const cheapest = costAt(COMPACT_OPTIONS[0]), yours = current ? costAt(current) : null;
  const option = (at) => {
    const cost = costAt(at), { count } = sim(COMPACT_OPTIONS[0], long.n, at);
    return {
      at: Math.round(at), window: Math.round(at + COMPACT_MARGIN), extraCost: cost / cheapest - 1,
      savedVsCurrent: yours == null ? null : (yours - cost) / totalPrice,
      longSession: { compactions: count, waitMinutes: +((count * waitMs) / 6e4).toFixed(1) },
      verbatimTokens: Math.round(at - base),
    };
  };
  return {
    sessions: runs.length, longSessionCalls: long.n,
    current: current && { at: Math.round(current), source, window, envAndSetting: env != null && s.autoCompactWindow != null },
    compactions: { manual: manual.length, auto: auto.length, medianManualAt: manual.length ? median(manual.map((c) => c.pre)) : null, medianWaitSeconds: Math.round(waitMs / 1e3) },
    model: { growthPerCall: Math.round(g), growthAfterCompaction: Math.round(gAfter), contextAfterCompaction: Math.round(base) },
    options: COMPACT_OPTIONS.map(option),
    currentOption: current ? option(current) : null,
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

// Script text is counted with count_tokens, using the login a capture records; if that
// fails, every text falls back to 3.5 characters per token.
async function textCounter() {
  try {
    const { req, headers } = await capture();
    const c = counter(headers, false);
    const say = (text) => ({ model: req.model, messages: [{ role: 'user', content: text }] });
    const bare = await c.count(say('ok'));
    if (bare !== null) return { exact: true, count: async (text) => Math.max(0, ((await c.count(say(`ok\n${text}`))) ?? bare + text.length / CHARS_PER_TOKEN) - bare) };
  } catch {}
  return { exact: false, count: async (text) => text.length / CHARS_PER_TOKEN };
}

async function editScripts(cutoff, total, ruleCost, readRate) {
  const r = { scripts: 0, replacements: 0, failed: 0, edits: 0, editsFailed: 0, patches: 0 };
  const texts = [];
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
      const later = calls.filter((x) => x > t).length;
      // The script minus its long string literals and the ~120 characters an Edit call
      // would have taken anyway.
      const body = cmd.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|`(?:\\[\s\S]|[^`])*`|"(?:\\.|[^"\n])*"|'(?:\\.|[^'\n])*'/g, (m) => (m.length >= 20 ? '' : m));
      texts.push({ text: body, scale: Math.max(0, cmd.length - literals(cmd) - 120) / Math.max(1, body.length), later });
      if (failedScript(cmd, res, out)) { r.failed++; texts.push({ text: cmd + out, scale: 1, later }); }
    }
  }
  const counted = texts.length ? await textCounter() : { exact: true };
  const costs = await pool(texts.map((x) => async () => { const tok = (await counted.count(x.text)) * x.scale; return 7 * tok + readRate * tok * x.later; }));
  const cost = costs.reduce((a, b) => a + b, 0);
  return { ...r, counting: counted.exact ? 'count_tokens' : 'estimate', share: Math.max(0, cost - ruleCost) / total };
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
  { id: 'attribution', name: 'Claude attribution in commits off', how: 'settings attribution: false', on: (s) => s.attribution === false, applies: (req) => has(req, /^Bash$/), patch: { attribution: false } },
  { id: 'powershell', name: 'PowerShell tool off (Windows)', how: 'env CLAUDE_CODE_USE_POWERSHELL_TOOL=0', on: (s) => envOn(s, 'CLAUDE_CODE_USE_POWERSHELL_TOOL', '0'), applies: (req) => process.platform === 'win32' && has(req, /^PowerShell$/), patch: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: '0' } }, tools: /^PowerShell$/, windows: true },
  { id: 'cron', name: 'Cron tools off (/loop stops working)', how: 'env CLAUDE_CODE_DISABLE_CRON=1', on: (s) => envOn(s, 'CLAUDE_CODE_DISABLE_CRON'), applies: (req) => has(req, /^Cron/), patch: { env: { CLAUDE_CODE_DISABLE_CRON: '1' } }, tools: /^Cron/ },
  { id: 'claude-ai-skills', name: 'claude.ai skill sync off', how: 'settings syncClaudeAiSkills: false', on: (s) => s.syncClaudeAiSkills === false, applies: () => true, patch: { syncClaudeAiSkills: false }, revert: { syncClaudeAiSkills: true } },
  { id: 'claude-ai-connectors', name: 'claude.ai connectors off', how: 'settings disableClaudeAiConnectors: true', on: (s) => s.disableClaudeAiConnectors === true, applies: (req) => has(req, /^mcp__claude_ai_/), patch: { disableClaudeAiConnectors: true } },
  { id: 'explore-plan', name: 'Explore/Plan agents off', how: 'env CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1', on: (s) => envOn(s, 'CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS'), applies: (req) => has(req, /^Agent$/), patch: { env: { CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS: '1' } }, revert: { env: { CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS: '0' } } },
];

// Side requests that re-send the whole conversation. The probe cannot see them.
const UNMEASURED = [
  { id: 'recap', name: 'Session recap off', how: 'settings awaySummaryEnabled: false', on: (s) => s.awaySummaryEnabled === false },
  // The variable is checked before the server flag and the setting, so it is the one
  // switch nothing else can turn back on.
  { id: 'suggestions', name: 'Prompt suggestions off', how: 'env CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=0', on: (s) => ['0', 'false', 'no', 'off'].includes(String(s.env?.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION ?? '').toLowerCase().trim()) },
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
      if (i.listing === `- ${i.name}`) r.nameOnly = true;
      // The user's own skills can keep their auto-trigger with a shorter description.
      // Plugin and built-in skills have no file here, and an update would undo the edit.
      const file = [join(CLAUDE_DIR, 'skills', i.name, 'SKILL.md'), join(process.cwd(), '.claude', 'skills', i.name, 'SKILL.md')].find((f) => existsSync(f));
      if (file) Object.assign(r, { file, ...(i.chars > SHORT_DESC * 1.5 && { shortenSaves: r.tokens - Math.round((r.tokens * SHORT_DESC) / i.chars) }) });
    } else if (['tool', 'mcp-tool', 'agent'].includes(i.kind)) { r.uses = use?.n ?? 0; r.sessions = use?.s.size ?? 0; r.headlessUses = use?.headless ?? 0; r.last = use?.last ?? ''; }
    if (i.kind === 'agent') r.userFile = existsSync(join(CLAUDE_DIR, 'agents', `${i.name}.md`));
    if (i.kind === 'mcp-instructions') r.uses = Object.entries(u.mcp).filter(([k]) => k.includes(i.name.replace(/\W+/g, '_'))).reduce((a, [, v]) => a + v.n, 0);
    if (i.kind === 'tool' || i.kind === 'mcp-tool') { r.deferred = u.deferred.has(i.name); r.core = CORE_TOOLS.has(i.name); r.headlessOnly = HEADLESS_ONLY.has(i.name); }
    // Grep and Glob stop being core when Claude already searches through Bash nearly
    // every time: the tool is then paid on every request for the rare call.
    const via = u.tool[i.kind === 'tool' && SEARCH_VIA_BASH[i.name]];
    if (via) {
      r.viaBash = { uses: via.n, sessions: via.s.size };
      if (via.n >= BASH_SEARCH_RATIO * Math.max(1, r.uses)) r.core = false;
    }
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
  // Claude Code picks the short prompt per model (Opus 4.8 and later and Sonnet 5.5 by
  // default; Opus 4.7 and earlier, Sonnet 5 and Haiku not), so the setting may change nothing here: unset and set to 1 give the same
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
  // A deferred tool is listed as one line with its name; each line is counted too.
  const deferredRows = rows.filter((r) => r.deferred);
  const say = (text) => ({ model: base.req.model, messages: [{ role: 'user', content: text }] });
  const bare = await count(say('ok'));
  await pool(deferredRows.map((r) => async () => { r.nameTokens = Math.max(0, (await count(say(`ok\n${r.name}`))) - bare); }));
  const interactive = total - rows.filter((r) => r.headlessOnly).reduce((a, r) => a + r.tokens, 0)
    - deferredRows.reduce((a, r) => a + r.tokens - r.nameTokens, 0);

  // The skill listing has a character budget (1% of the context window by default).
  // Over it, the least-used skills are listed by name only, and removing a skill mostly
  // hands its room to them, so the skill total drops by less than the per-skill figures.
  // A skill set to name-only in skillOverrides is listed that way on purpose.
  const overrides = s.skillOverrides ?? {};
  const nameOnly = rows.filter((r) => r.nameOnly).map((r) => r.name);
  const skillListing = { nameOnly, overBudget: nameOnly.some((k) => (overrides[k] ?? overrides[k.split(':').pop()]) !== 'name-only') };
  // The same skill installed twice (a copy in ~/.claude/skills and one in a plugin, say)
  // is listed twice under different names; one copy can go with nothing lost.
  const byText = {};
  for (const i of items.filter((x) => x.kind === 'skill')) {
    const desc = i.listing.replace(/^- [^:\n]+:\s*/, '');
    if (desc && desc !== i.listing) (byText[desc] ??= []).push(i.name);
  }
  const duplicateSkills = Object.values(byText).filter((g) => g.length > 1).map((names) => ({ names, tokens: rows.find((r) => r.kind === 'skill' && r.name === names[1])?.tokens ?? 0 }));

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
    restore, skillOverrides: overrides, skillListing, duplicateSkills,
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
    const effect = w.modelDefault ? `none here; about −${n(w.fullCost)} on Haiku, Sonnet 5 or Opus 4.7 and earlier`
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
  if (o.skillListing.overBudget) L.push('', '## Skill listing over budget', '', `Claude Code caps the skill listing (skillListingBudgetFraction, 1% of the context window by default). ${o.skillListing.nameOnly.length} skills are listed by name only: ${o.skillListing.nameOnly.join(', ')}. Removing other skills gives their descriptions back before it saves tokens.`);
  if (o.duplicateSkills.length) {
    L.push('', '## Skills listed twice', '', '| Names | Tokens per extra copy |', '|---|---:|');
    for (const d of o.duplicateSkills) L.push(`| ${d.names.join(', ')} | ${n(d.tokens)} |`);
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

// ---------- compare ----------
// What changed between two reports and what each change saved, in interactive terms
// (a deferred tool costs only its name). The total is measured; the per-change figures
// come from the before report, so their sum is checked against the total and the gap
// is reported as `unexplained`, with `check: "mismatch"` when it is too large to trust.

export function compare(before, after) {
  for (const [label, o] of [['before', before], ['after', after]]) {
    if (!Number.isFinite(o?.interactive) || !Array.isArray(o?.rows) || !Array.isArray(o?.switches)) throw new Error(`${label} report has no interactive, rows or switches`);
  }
  const key = (r) => `${r.kind}\t${r.name}`;
  const cost = (r) => (r.deferred ? r.nameTokens ?? Math.ceil((r.name.length + 1) / CHARS_PER_TOKEN) : r.tokens);
  // Headless-only tools never reach an interactive session.
  const rows = (o) => o.rows.filter((r) => !r.headlessOnly);
  const afterRows = new Map(rows(after).map((r) => [key(r), r]));
  let removed = rows(before).filter((r) => !afterRows.has(key(r)));
  const changes = [];
  const take = (match) => { const hit = removed.filter(match); removed = removed.filter((r) => !match(r)); return hit; };
  // This skill never edits instruction files, so one missing from the after report
  // means it ran from another directory or the file changed outside it. Left in
  // `unexplained` and named in `outside`.
  const outside = take((r) => r.kind === 'instructions');

  // Switches turned on. One that removes tools is worth the rows it took; one that
  // rewrites text (short prompt, git) is worth its measured delta, and the prompt or
  // reminder rows it dropped belong to it.
  const was = Object.fromEntries(before.switches.map((w) => [w.id, w]));
  for (const w of after.switches) {
    const b = was[w.id];
    if (!w.on || !b || b.on) continue;
    const re = SWITCHES.find((x) => x.id === w.id)?.tools;
    const hit = re ? take((r) => re.test(r.name))
      : w.id === 'claude-ai-connectors' ? take((r) => /^mcp__claude_ai_/.test(r.name) || (r.kind === 'mcp-instructions' && r.name.startsWith('claude.ai ')))
      : w.id === 'claude-ai-skills' ? take((r) => r.kind === 'skill' && (b.skills ?? []).includes(r.name))
      : take((r) => r.kind === 'system-prompt' || r.kind === 'reminder');
    const sum = hit.reduce((a, r) => a + cost(r), 0);
    changes.push({ change: w.name, how: w.how, tokens: re || w.id === 'claude-ai-connectors' ? sum : b.saves ?? sum });
  }
  // Plugins disabled: everything they added, as one change.
  const plugins = new Set((after.plugins ?? []).map((p) => p.name));
  for (const p of before.plugins ?? []) {
    if (plugins.has(p.name)) continue;
    const hit = take((r) => r.plugin === p.name);
    if (hit.length) changes.push({ change: `plugin ${p.key}`, tokens: hit.reduce((a, r) => a + cost(r), 0) });
  }
  for (const r of removed) changes.push({ change: `${r.kind} ${r.name}`, tokens: cost(r) });
  // Skills and agents still listed with a shorter description.
  for (const r of rows(before)) {
    const a = afterRows.get(key(r));
    if (a && ['skill', 'agent'].includes(r.kind) && r.tokens - a.tokens >= 10) changes.push({ change: `${r.kind} ${r.name} shortened`, tokens: r.tokens - a.tokens });
  }
  changes.sort((x, y) => y.tokens - x.tokens);

  const saved = before.interactive - after.interactive;
  const explained = changes.reduce((a, c) => a + c.tokens, 0);
  const unexplained = saved - explained;
  const beforeKeys = new Set(rows(before).map(key));
  const bg = Object.fromEntries((before.unmeasured ?? []).map((w) => [w.id, w.on]));
  return {
    before: { interactive: before.interactive, total: before.total }, after: { interactive: after.interactive, total: after.total },
    saved, percent: before.interactive ? +((100 * saved) / before.interactive).toFixed(1) : 0,
    changes, background: (after.unmeasured ?? []).filter((w) => w.on && bg[w.id] === false).map((w) => w.name),
    // Rows only the after report has: usually an MCP server that connected in one
    // capture and not the other. They are the first place to look for a gap.
    added: rows(after).filter((r) => !beforeKeys.has(key(r))).map((r) => ({ kind: r.kind, name: r.name, tokens: cost(r) })),
    outside: outside.map((r) => ({ name: r.name, tokens: r.tokens })),
    unexplained, check: Math.abs(unexplained) <= Math.max(300, 0.1 * Math.abs(saved)) ? 'ok' : 'mismatch',
  };
}

// ---------- cli ----------

function arg(args, name, dflt = null) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'report') {
    await report({ days: Number(arg(args, '--days', Infinity)), json: arg(args, '--json'), estimate: args.includes('--estimate') });
  } else if (cmd === 'compare') {
    if (args.length < 2) throw new Error('compare needs <before.json> <after.json>');
    const [before, after] = args.slice(0, 2).map((f) => JSON.parse(readFileSync(f, 'utf8')));
    process.stdout.write(JSON.stringify(compare(before, after), null, 1) + '\n');
  } else if (cmd === 'stretch') {
    const r = await stretch(Number(arg(args, '--saved', 0)), Number(arg(args, '--days', Infinity)));
    process.stdout.write(r ? JSON.stringify(r, null, 1) + '\n' : 'no transcripts in the window\n');
  } else if (cmd === 'capture') {
    const settings = arg(args, '--settings'); const out = arg(args, '--out');
    const { req } = await capture({ settings: settings ? JSON.parse(settings) : null });
    if (out) writeFileSync(out, JSON.stringify(req));
    else process.stdout.write(JSON.stringify(breakdown(req).map(({ cut, ...i }) => i), null, 1) + '\n');
  } else {
    process.stdout.write('usage: lean.mjs report [--days N] [--json out.json] [--estimate] | stretch --saved N [--days N] | compare before.json after.json | capture [--out f] [--settings json]\n');
    process.exitCode = cmd ? 2 : 0;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { process.stderr.write(`lean-claude: ${e.message}\n`); process.exitCode = 1; });
}
