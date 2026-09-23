#!/usr/bin/env node
// Measures what Claude Code sends on every request, per component, and joins it with
// how often each component was actually used in local transcripts.
//
//   node diet.mjs report [--days 90] [--calibrate] [--json <file>]
//   node diet.mjs capture --out <file> [--env K=V]... [--settings '<json>']
//
// Capturing costs no tokens: Claude Code is pointed at a local server that records the
// first request and answers with an error. --calibrate sends one real "say ok" request
// to turn characters into exact tokens; without it, 3.5 characters count as one token.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const CHARS_PER_TOKEN = 3.5;
const CORE_TOOLS = new Set(['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill', 'ToolSearch']);
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

// ---------- capture ----------

// One command string: passing an argv array with shell:true is deprecated in Node 24.
function claudeCmd(settingsFile, extra = []) {
  const q = (s) => (process.platform === 'win32' ? `"${s}"` : `'${s}'`);
  const a = ['claude', '-p', '--no-session-persistence', ...extra];
  if (settingsFile) a.push('--settings', q(settingsFile));
  a.push(q('say ok'));
  return a.join(' ');
}

export function capture({ env = {}, settings = null, cwd = process.cwd(), timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    let body = null;
    const srv = http.createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d)).on('end', () => {
        if (body === null && req.url.includes('/v1/messages') && !req.url.includes('count_tokens')) body = b;
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'captured by context-diet' } }));
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      let settingsFile = null;
      if (settings) { settingsFile = join(mkdtempSync(join(tmpdir(), 'context-diet-')), 'settings.json').replace(/\\/g, '/'); writeFileSync(settingsFile, JSON.stringify(settings)); }
      const childEnv = { ...process.env, ...env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${srv.address().port}` };
      const c = spawn(claudeCmd(settingsFile), { env: childEnv, cwd, shell: true, stdio: 'ignore' });
      const t = setTimeout(() => c.kill(), timeoutMs);
      c.on('error', (e) => { clearTimeout(t); srv.close(); reject(e); });
      c.on('exit', () => {
        clearTimeout(t); srv.close();
        if (body === null) reject(new Error('Claude Code sent no request (is `claude` on PATH and logged in?)'));
        else resolve(JSON.parse(body));
      });
    });
  });
}

// One real request, to learn the exact input-token count of the current setup.
function realTokens(cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const c = spawn(claudeCmd(null, ['--output-format', 'json']), { cwd, shell: true });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('exit', () => {
      try {
        const u = JSON.parse(out.trim().split('\n').pop()).usage;
        resolve(u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0));
      } catch (e) { reject(new Error(`calibration failed: ${out.slice(0, 200)}`)); }
    });
  });
}

// ---------- breakdown ----------

const size = (x) => JSON.stringify(x).length;

function splitBy(text, re) {
  const parts = []; let cur = null;
  for (const line of text.split('\n')) {
    const m = re.exec(line);
    if (m) { cur = { name: m[1].trim(), text: line }; parts.push(cur); } else if (cur) cur.text += '\n' + line;
  }
  return parts;
}

function classifyReminder(text, add) {
  const body = text.replace(/^<system-reminder>\n?/, '').replace(/<\/system-reminder>\s*$/, '');
  if (body.includes('Codebase and user instructions')) {
    for (const p of splitBy(body, /^Contents of (.+?) \(/)) add('instructions', p.name, size(p.text));
  } else if (body.startsWith('The following skills are available')) {
    for (const p of splitBy(body, /^- (.+?):(?: |$)/)) add('skill', p.name, size(p.text));
  } else if (body.startsWith('Available agent types')) {
    for (const p of splitBy(body, /^- (.+?):(?: |$)/)) add('agent', p.name, size(p.text));
  } else if (body.includes('# MCP Server Instructions')) {
    for (const p of splitBy(body, /^## (.+)$/)) add('mcp-instructions', p.name, size(p.text));
  } else if (/deferred tools/i.test(body.slice(0, 200))) {
    add('deferred-tool-list', 'names of deferred tools', size(text));
  } else {
    const head = (body.match(/^#+ (.+)$/m)?.[1] ?? body.split('\n').find((l) => l.trim()) ?? '').slice(0, 60);
    add('reminder', head, size(text));
  }
}

export function breakdown(req) {
  const items = [];
  const add = (kind, name, chars) => items.push({ kind, name, chars });
  (req.system ?? []).forEach((s, i) => {
    const text = typeof s === 'string' ? s : s.text ?? '';
    const sections = splitBy(text, /^# (.+)$/);
    if (sections.length < 2) add('system-prompt', i === 0 ? 'header' : `block ${i}`, size(text));
    else {
      const pre = text.slice(0, text.indexOf(sections[0].text));
      if (pre.trim()) add('system-prompt', 'preamble', size(pre));
      for (const p of sections) add('system-prompt', p.name, size(p.text));
    }
  });
  for (const t of req.tools ?? []) {
    const m = /^mcp__(.+?)__/.exec(t.name ?? '');
    add(m ? 'mcp-tool' : 'tool', t.name ?? t.type, size(t));
  }
  for (const msg of req.messages ?? []) {
    const blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];
    for (const b of blocks) {
      if (b.type !== 'text' || !b.text) continue;
      if (msg.role === 'system') {
        // Newer versions send the listings as one system-role message without reminder tags.
        for (const p of splitBy(b.text, /^(# [^#].*|Available agent types.*|The following .*)$/)) classifyReminder(p.text, add);
      } else {
        for (const r of b.text.match(/<system-reminder>[\s\S]*?<\/system-reminder>/g) ?? []) classifyReminder(r, add);
      }
    }
  }
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
  const u = { tool: {}, skill: {}, agent: {}, mcp: {}, sessions: 0, deferred: new Set(), deferredAt: 0, from: null };
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
      if (typeof content === 'string') {
        for (const m of content.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) bump(u.skill, m[1], ts);
        continue;
      }
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type === 'text' && b.text?.includes('<command-name>')) for (const m of b.text.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) bump(u.skill, m[1], ts);
        if (b.type !== 'tool_use') continue;
        bump(u.tool, b.name, ts);
        if (b.name === 'Skill' && b.input?.skill) bump(u.skill, b.input.skill, ts);
        if ((b.name === 'Agent' || b.name === 'Task')) bump(u.agent, b.input?.subagent_type || 'general-purpose', ts);
        const m = /^mcp__(.+?)__/.exec(b.name); if (m) bump(u.mcp, m[1], ts);
      }
    }
  }
  return u;
}

// ---------- levers measured by capture ----------
// Env switches go through --settings: settings.json `env` overrides the process environment.

function userSettings() {
  try { return JSON.parse(readFileSync(join(CLAUDE_DIR, 'settings.json'), 'utf8')); } catch { return {}; }
}

const LEVERS = [
  { name: 'Short system prompt', how: 'env CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1', on: (s) => s.env?.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT === '1', v: { settings: { env: { CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '1' } } } },
  { name: 'Git instructions off', how: 'settings includeGitInstructions: false', on: (s) => s.includeGitInstructions === false, v: { settings: { includeGitInstructions: false } } },
  { name: 'Explore/Plan agents off', how: 'env CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1', on: (s) => s.env?.CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS === '1', v: { settings: { env: { CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS: '1' } } } },
];

// ---------- report ----------

const total = (items) => items.reduce((a, i) => a + i.chars, 0);

async function report({ days = 90, calibrate = false, json = null }) {
  const base = await capture();
  const items = breakdown(base);
  const baseChars = size(base.system) + size(base.tools) + size(base.messages);
  let ratio = 1 / CHARS_PER_TOKEN, exact = null;
  if (calibrate) { exact = await realTokens(); ratio = exact / baseChars; }
  const tok = (c) => Math.round(c * ratio);
  const u = await usage(days);
  const s = userSettings();

  const levers = [];
  for (const l of LEVERS) {
    if (l.on(s)) { levers.push({ ...l, saves: 0, already: true }); continue; }
    const req = await capture(l.v);
    levers.push({ ...l, saves: tok(baseChars - (size(req.system) + size(req.tools) + size(req.messages))) });
  }

  const deferred = u.deferred;
  const rows = items.map((i) => {
    const r = { ...i, tokens: tok(i.chars) };
    if (i.kind === 'tool' || i.kind === 'mcp-tool') {
      r.uses = u.tool[i.name]?.n ?? 0; r.last = u.tool[i.name]?.last ?? '';
      r.deferred = deferred.has(i.name);
      r.core = CORE_TOOLS.has(i.name);
    } else if (i.kind === 'skill') { const k = u.skill[i.name]; r.uses = k?.n ?? 0; r.last = k?.last ?? ''; }
    else if (i.kind === 'agent') { r.uses = u.agent[i.name]?.n ?? 0; r.last = u.agent[i.name]?.last ?? ''; }
    else if (i.kind === 'mcp-instructions') { r.uses = u.mcp[i.name]?.n ?? null; }
    return r;
  });

  // Headless mode loads every tool in full. Interactive sessions list deferred tools by
  // name only and load the full definition when a tool is first searched for.
  const totalTokens = exact ?? tok(baseChars);
  const deferredRows = rows.filter((r) => r.deferred);
  const interactiveTokens = totalTokens - deferredRows.reduce((a, r) => a + r.tokens, 0) + deferredRows.reduce((a, r) => a + tok(r.name.length + 4), 0);
  const out = {
    measuredWith: exact ? 'calibrated' : `estimate (${CHARS_PER_TOKEN} chars/token)`,
    totalTokens, interactiveTokens, window: { days, from: u.from, sessions: u.sessions },
    byKind: Object.entries(rows.reduce((a, r) => ((a[r.kind] = (a[r.kind] ?? 0) + r.tokens), a), {})).sort((a, b) => b[1] - a[1]),
    rows: rows.sort((a, b) => b.tokens - a.tokens), levers,
    deferredKnown: deferred.size > 0,
  };
  if (json) writeFileSync(json, JSON.stringify(out, null, 2));
  process.stdout.write(render(out));
}

function render(o) {
  const L = [];
  const n = (x) => x.toLocaleString('en-US');
  L.push(`# Context diet report`, '');
  L.push(`Every request starts with about **${n(o.interactiveTokens)} tokens** in an interactive session, ${n(o.totalTokens)} in headless mode (${o.measuredWith}, probed from this folder).`);
  if (!o.deferredKnown) L.push('No transcript showed which tools are deferred, so the interactive figure equals the headless one.');
  L.push(`Usage window: last ${o.window.days} days, ${o.window.sessions} transcript files${o.window.from ? `, from ${o.window.from}` : ''}.`, '');
  L.push('## Where the tokens go', '', '| Kind | Tokens |', '|---|---:|');
  for (const [k, t] of o.byKind) L.push(`| ${k} | ${n(t)} |`);
  L.push('', '## Switches', '', '| Switch | How | Saves per request |', '|---|---|---:|');
  for (const l of o.levers) L.push(`| ${l.name} | \`${l.how}\` | ${l.already ? 'already on' : n(l.saves)} |`);
  const cand = (r) => (r.kind === 'tool' || r.kind === 'mcp-tool') ? !r.core : ['skill', 'agent'].includes(r.kind);
  const table = (title, list, extra = '') => {
    L.push('', `## ${title}`, '', ...(extra ? [extra, ''] : []), '| Kind | Name | Tokens | Uses | Last used |', '|---|---|---:|---:|---|');
    for (const r of list) L.push(`| ${r.kind} | ${r.name} | ${n(r.tokens)} | ${r.uses ?? ''}${r.uses === 0 ? ' (unused)' : ''} | ${r.last ?? ''} |`);
  };
  table('Always loaded: tools, skills and agents by cost', o.rows.filter((r) => cand(r) && !r.deferred));
  const def = o.rows.filter((r) => cand(r) && r.deferred);
  if (def.length) table('Deferred tools', def, 'Interactive sessions list these by name and load the full definition only when used, so the tokens below are paid only in sessions that use the tool (and in headless `-p` runs).');
  const other = o.rows.filter((r) => !cand(r) && r.tokens >= 200);
  L.push('', '## Other large items', '', '| Kind | Name | Tokens |', '|---|---|---:|');
  for (const r of other) L.push(`| ${r.kind} | ${r.name} | ${n(r.tokens)} |`);
  L.push('');
  return L.join('\n');
}

// ---------- cli ----------

function arg(args, name, dflt = null) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'report') {
    await report({ days: Number(arg(args, '--days', 90)), calibrate: args.includes('--calibrate'), json: arg(args, '--json') });
  } else if (cmd === 'capture') {
    const env = {}; args.forEach((a, i) => { if (a === '--env') { const [k, ...v] = args[i + 1].split('='); env[k] = v.join('='); } });
    const settings = arg(args, '--settings'); const out = arg(args, '--out');
    const req = await capture({ env, settings: settings ? JSON.parse(settings) : null });
    if (out) writeFileSync(out, JSON.stringify(req)); else process.stdout.write(JSON.stringify(breakdown(req), null, 1) + '\n');
  } else {
    process.stdout.write('usage: diet.mjs report [--days 90] [--calibrate] [--json out.json] | capture [--out f] [--env K=V] [--settings json]\n');
    process.exitCode = cmd ? 2 : 0;
  }
}

main().catch((e) => { process.stderr.write(`context-diet: ${e.message}\n`); process.exitCode = 1; });
