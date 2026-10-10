#!/usr/bin/env node
// Benchmark runner: stock agy against the plugin's agy-chore agent on the same tasks.
//
//   node run.mjs --arm stock|custom --tasks <file> --repo <dir> --out <dir>
//                [--only id,id] [--workers 3] [--timeout 900] [--model gemini-3.7-flash-low]
//
// The tasks file is {"tasks": [{"id", "brief"}]}; "{REPO}" in a brief becomes the
// repo path. Each task writes <out>/<id>.<arm>.json. A task whose result exists is
// skipped, so a rerun picks up where a quota stop left off.
//
// The stock arm takes the plugin's bash server out of agy's MCP config for the run
// and puts it back after, so run one arm at a time.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { mcpConfigPath, resolveBin } from '../../scripts/lib/agy.mjs';
import { rawLogPath } from '../../scripts/lib/jobs.mjs';
import { killTree } from '../../scripts/lib/killtree.mjs';
import { parseLine, summariseEvents } from '../../scripts/lib/parse.mjs';
import { jobsDir } from '../../scripts/lib/paths.mjs';
import { run, spawnDirect } from '../../scripts/lib/run.mjs';

const { values: o } = parseArgs({
  options: {
    arm: { type: 'string' },
    tasks: { type: 'string' },
    repo: { type: 'string' },
    out: { type: 'string' },
    only: { type: 'string', default: '' },
    workers: { type: 'string', default: '3' },
    timeout: { type: 'string', default: '900' },
    model: { type: 'string', default: 'gemini-3.7-flash-low' },
  },
});
if (!['stock', 'custom'].includes(o.arm ?? '') || !o.tasks || !o.repo || !o.out) {
  console.error('usage: node run.mjs --arm stock|custom --tasks <file> --repo <dir> --out <dir> [--only a,b] [--workers 3] [--timeout 900] [--model id]');
  process.exit(2);
}
const REPO = resolve(o.repo).replace(/\\/g, '/');
const OUT = resolve(o.out);
const TIMEOUT = Number(o.timeout);
const DELEGATE = fileURLToPath(new URL('../../scripts/delegate.mjs', import.meta.url));
const only = o.only.split(',').filter(Boolean);
const { tasks } = JSON.parse(readFileSync(o.tasks, 'utf8'));
mkdirSync(OUT, { recursive: true });
const queue = tasks.filter((t) => (!only.length || only.includes(t.id)) && !existsSync(join(OUT, `${t.id}.${o.arm}.json`)));
const BIN = await resolveBin();
const VERSION = (await run(BIN, ['--version'], { timeoutMs: 30_000 })).stdout.trim();

if (o.arm === 'stock' && existsSync(mcpConfigPath())) {
  const cfg = mcpConfigPath();
  const bak = join(OUT, 'mcp_config.backup.json');
  copyFileSync(cfg, bak);
  const c = JSON.parse(readFileSync(cfg, 'utf8'));
  delete c.mcpServers?.agy;
  writeFileSync(cfg, `${JSON.stringify(c, null, 2)}\n`);
  process.on('exit', () => copyFileSync(bak, cfg));
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));
}

/** Stock agy: its default agent and tools, the brief sent as is. */
function runStock(brief) {
  const args = ['--output-format', 'stream-json', '--input-format', 'stream-json', '--disable-slash-commands',
    '--add-dir', REPO, '--print-timeout', `${Math.ceil(TIMEOUT / 60)}m`, '--model', o.model, '--dangerously-skip-permissions'];
  const since = Date.now();
  return new Promise((res) => {
    const c = spawnDirect(BIN, args, { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const events = [];
    let err = '';
    /** Seconds until agy's result event; the process may stay alive well past it. */
    let answeredAt;
    createInterface({ input: c.stdout }).on('line', (line) => {
      const ev = parseLine(line);
      if (!ev) return;
      events.push(ev);
      if (ev.event === 'result' && answeredAt === undefined) answeredAt = (Date.now() - since) / 1000;
    });
    c.stderr.on('data', (d) => (err += d));
    c.stdin.end(`${JSON.stringify({ event: 'user', message: { content: brief } })}\n`);
    let killed = false;
    const dog = setTimeout(() => { killed = true; void killTree(c.pid); }, (TIMEOUT + 60) * 1000);
    c.on('close', (code) => {
      clearTimeout(dog);
      const s = summariseEvents(events);
      res({ wall: (Date.now() - since) / 1000, answeredAt, exit: code, killed, stderrTail: err.slice(-600),
        conversationId: s.conversationId, report: s.response, agyStatus: s.status, toolCalls: s.toolCalls });
    });
  });
}

/** The job record delegate.mjs wrote for this brief, if any. */
function findJob(brief, since) {
  const dir = jobsDir(REPO);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return undefined; }
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (j.prompt?.trim().startsWith(brief.trim()) && Date.parse(j.startedAt) >= since - 2000) return j;
    } catch { /* partly written */ }
  }
  return undefined;
}

/** The plugin's path: delegate.mjs --chore, which runs the agy-chore agent with the bash tool. */
async function runCustom(id, brief) {
  const file = join(OUT, `${id}.custom.brief.md`);
  writeFileSync(file, `${brief}\n`);
  const since = Date.now();
  const r = await new Promise((res) => {
    const c = spawn(process.execPath, [DELEGATE, '--model', o.model, '--timeout', String(TIMEOUT), '--chore', '--prompt-file', file], {
      cwd: REPO, env: { ...process.env, CAD_RELEASE_CHECK: 'off' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    let killed = false;
    const dog = setTimeout(() => { killed = true; void killTree(c.pid); }, (TIMEOUT + 120) * 1000);
    c.on('close', (code) => { clearTimeout(dog); res({ code, out, killed }); });
  });
  const wall = (Date.now() - since) / 1000;
  const job = findJob(brief, since);
  let toolCalls;
  try {
    toolCalls = summariseEvents(readFileSync(rawLogPath(REPO, job.id), 'utf8').split('\n').map(parseLine).filter(Boolean)).toolCalls;
  } catch { /* no job or no log */ }
  return { wall, exit: r.code, killed: r.killed, stdoutTail: r.out.slice(-600),
    conversationId: job?.conversationId, report: job?.summary, agyStatus: job?.agyStatus, toolCalls, job };
}

let next = 0;
async function worker(n) {
  while (next < queue.length) {
    const t = queue[next++];
    const brief = t.brief.replaceAll('{REPO}', REPO);
    console.log(`[w${n}] start ${t.id}.${o.arm} ${new Date().toISOString()}`);
    try {
      const r = o.arm === 'stock' ? await runStock(brief) : await runCustom(t.id, brief);
      writeFileSync(join(OUT, `${t.id}.${o.arm}.json`), JSON.stringify({ task: t.id, arm: o.arm, model: o.model, agy: VERSION, ...r }, null, 1));
      console.log(`[w${n}] done  ${t.id}.${o.arm} wall=${r.wall.toFixed(0)}s answered=${r.answeredAt?.toFixed(0) ?? '-'}s status=${r.agyStatus} exit=${r.exit}`);
      if (/quota|RESOURCE_EXHAUSTED|429/i.test(`${r.stderrTail ?? ''}${r.stdoutTail ?? ''}${r.job?.error ?? ''}`)) {
        console.log('QUOTA - stopping');
        next = queue.length;
      }
    } catch (e) {
      console.log(`[w${n}] FAIL  ${t.id}.${o.arm} ${e?.stack ?? e}`);
    }
  }
}
console.log(`agy ${VERSION} | arm ${o.arm} | queue ${queue.map((t) => t.id).join(' ') || '(empty)'}`);
await Promise.all(Array.from({ length: Number(o.workers) }, (_, n) => worker(n)));
console.log('all done');
