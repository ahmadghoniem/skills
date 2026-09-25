#!/usr/bin/env node
// Measures what Claude Code sends on every request, per component, and joins it with
// how often each component was actually used in local transcripts.
//
//   node lean.mjs report [--days 90] [--json <file>] [--estimate]
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
import { join } from 'node:path';
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

export async function usage(days) {
  const cutoff = Date.now() - days * 864e5;
  const u = { tool: {}, skill: {}, typed: {}, agent: {}, mcp: {}, sessions: 0, deferred: new Set(), deferredAt: 0, from: null };
  const bump = (m, k, ts) => { const e = (m[k] ??= { n: 0, last: '' }); e.n++; if (ts > e.last) e.last = ts; };
  const root = join(CLAUDE_DIR, 'projects');
  if (!existsSync(root)) return u;
  for (const { p, mtime } of walk(root)) {
    if (mtime < cutoff) continue;
    u.sessions++;
    for await (const line of createInterface({ input: createReadStream(p) })) {
      if (!line.includes('tool_use') && !line.includes('command-name') && !line.includes('deferred_tools_delta')) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const ts = String(e.timestamp ?? '').slice(0, 10);
      if (ts && Date.parse(ts) < cutoff) continue;
      if (ts && (!u.from || ts < u.from)) u.from = ts;
      if (e.attachment?.type === 'deferred_tools_delta' && Date.parse(e.timestamp) > u.deferredAt) {
        u.deferredAt = Date.parse(e.timestamp); u.deferred = new Set(e.attachment.addedNames ?? []);
      }
      const content = e.message?.content;
      const typed = (s) => { for (const m of s.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) bump(u.typed, m[1], ts); };
      if (typeof content === 'string') { typed(content); continue; }
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type === 'text' && b.text?.includes('<command-name>')) typed(b.text);
        if (b.type !== 'tool_use') continue;
        bump(u.tool, b.name, ts);
        if (b.name === 'Skill' && b.input?.skill) bump(u.skill, b.input.skill, ts);
        if (b.name === 'Agent' || b.name === 'Task') bump(u.agent, b.input?.subagent_type || 'general-purpose', ts);
        const m = /^mcp__(.+?)__/.exec(b.name); if (m) bump(u.mcp, m[1], ts);
      }
    }
  }
  return u;
}

// ---------- switches ----------
// Env switches go through --settings: settings.json `env` overrides the process
// environment. `patch` turns the switch on, `revert` measures what turning it back
// off would cost; `applies` says whether it can do anything on this setup.

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } }
const userSettings = () => readJson(join(CLAUDE_DIR, 'settings.json'));
const envOn = (s, k, v = '1') => s.env?.[k] === v;
const has = (req, re) => (req.tools ?? []).some((t) => re.test(t.name ?? ''));

const SWITCHES = [
  { id: 'artifact', name: 'Artifact off', how: 'settings enableArtifact: false', on: (s) => s.enableArtifact === false || s.disableArtifact === true, applies: (req) => has(req, /^Artifact/), patch: { enableArtifact: false }, tools: /^Artifact/ },
  { id: 'simple-prompt', name: 'Short system prompt', how: 'env CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1', on: (s) => envOn(s, 'CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT'), applies: () => true, patch: { env: { CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '1' } }, revert: { env: { CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '0' } } },
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

async function report({ days = 90, json = null, estimate = false }) {
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

  const tokens = await pool(items.map((i) => async () => Math.max(0, total - (await count(i.cut(base.req))))));
  const rows = items.map((i, k) => {
    const r = { kind: i.kind, name: i.name, chars: i.chars, tokens: tokens[k] };
    // A skill is used by the model (Skill tool) or typed by the user (/name); the two
    // counts decide between turning it off and hiding it from the model only.
    const sk = (m) => m[i.name] ?? m[i.name.split(':').pop()];
    const use = i.kind === 'tool' || i.kind === 'mcp-tool' ? u.tool[i.name] : i.kind === 'agent' ? u.agent[i.name] : null;
    if (i.kind === 'skill') {
      const [a, b] = [sk(u.skill), sk(u.typed)];
      Object.assign(r, { modelUses: a?.n ?? 0, typed: b?.n ?? 0, uses: (a?.n ?? 0) + (b?.n ?? 0), last: [a?.last ?? '', b?.last ?? ''].sort().pop() });
    } else if (['tool', 'mcp-tool', 'agent'].includes(i.kind)) { r.uses = use?.n ?? 0; r.last = use?.last ?? ''; }
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
  const measured = await pool(variants.map((w) => async () => {
    if (!w.isOn && w.applies(base.req)) return { saves: await delta(w, w.patch) };
    if (w.isOn && w.revert) { const c = -(await delta(w, w.revert)); return c > 0 ? { restoreCost: c } : {}; }
    return {};
  }), 3);
  const switches = variants.filter((w, k) => w.isOn || w.applies(base.req)).map((w) => {
    const m = measured[variants.indexOf(w)];
    return { id: w.id, name: w.name, how: w.how, on: w.isOn, windowsOnly: Boolean(w.windows), ...m };
  });

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
    total, interactive, platform: process.platform, window: { days, from: u.from, sessions: u.sessions }, deferredKnown: u.deferred.size > 0,
    byKind: Object.entries(rows.reduce((a, r) => ((a[r.kind] = (a[r.kind] ?? 0) + r.tokens), a), {})).sort((a, b) => b[1] - a[1]),
    rows: rows.sort((a, b) => b.tokens - a.tokens),
    plugins: Object.values(plugins).sort((a, b) => b.tokens - a.tokens),
    switches, unmeasured: UNMEASURED.map((w) => ({ id: w.id, name: w.name, how: w.how, on: w.on(s) })),
    restore, skillOverrides: s.skillOverrides ?? {},
  };
  if (json) writeFileSync(json, JSON.stringify(out, null, 2));
  process.stdout.write(render(out));
}

function render(o) {
  const L = [];
  const n = (x) => (x ?? 0).toLocaleString('en-US');
  const used = (r) => `${r.uses ?? ''}${r.uses === 0 ? ' (unused)' : ''}`;
  L.push('# lean-claude report', '');
  L.push(`Every request starts with **${n(o.interactive)} tokens** in an interactive session, ${n(o.total)} in headless mode.`);
  L.push(`${o.counting}, model ${o.model}, ${o.version}. Usage: last ${o.window.days} days, ${o.window.sessions} transcripts${o.window.from ? ` from ${o.window.from}` : ''}.`);
  if (!o.deferredKnown) L.push('No transcript showed which tools are deferred, so the interactive figure equals the headless one.');
  L.push('', '## Where the tokens go', '', '| Kind | Tokens |', '|---|---:|');
  for (const [k, t] of o.byKind) L.push(`| ${k} | ${n(t)} |`);
  L.push('', '## Switches', '', '| Switch | How | Status | Tokens |', '|---|---|---|---:|');
  for (const w of o.switches) L.push(`| ${w.name} | \`${w.how}\` | ${w.on ? 'on' : 'off'} | ${w.on ? (w.restoreCost != null ? `+${n(w.restoreCost)} to undo` : '') : `−${n(w.saves)}`} |`);
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
    await report({ days: Number(arg(args, '--days', 90)), json: arg(args, '--json'), estimate: args.includes('--estimate') });
  } else if (cmd === 'capture') {
    const settings = arg(args, '--settings'); const out = arg(args, '--out');
    const { req } = await capture({ settings: settings ? JSON.parse(settings) : null });
    if (out) writeFileSync(out, JSON.stringify(req));
    else process.stdout.write(JSON.stringify(breakdown(req).map(({ cut, ...i }) => i), null, 1) + '\n');
  } else {
    process.stdout.write('usage: lean.mjs report [--days 90] [--json out.json] [--estimate] | capture [--out f] [--settings json]\n');
    process.exitCode = cmd ? 2 : 0;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { process.stderr.write(`lean-claude: ${e.message}\n`); process.exitCode = 1; });
}
