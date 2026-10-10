#!/usr/bin/env node
// A `bash` tool for agy, served over MCP stdio (newline-delimited JSON-RPC).
// agy's own run_command runs PowerShell and backgrounds anything over 10 s;
// this runs bash (Git Bash on Windows) in the foreground until the command ends
// or times out.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { BUDGET, readTarget, shorten } from './shorten.mjs';

const WIN = process.platform === 'win32';
const BASH = process.env.AGY_BASH || (WIN ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash');
// tools/apply-patch at the repo root, reached in scripts as the `apply-patch` function.
const APPLY_PATCH = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), '../../../tools/apply-patch/apply-patch.mjs').replace(/\\/g, '/');
// Git Bash's own kill.exe, which can signal an MSYS process group.
const MSYS_KILL = join(dirname(BASH).replace(/[\\/]usr[\\/]bin$|[\\/]bin$/i, ''), 'usr', 'bin', 'kill.exe');
const CWD = process.env.AGY_BASH_CWD || process.cwd();
const OUT_DIR = join(tmpdir(), 'agy-bash');
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 1_200_000;
const MAX_DIFF_LINES = 400;
// Full outputs of shortened results, kept for a day so the model can read them.
const KEEP_OUTPUT_MS = 24 * 60 * 60 * 1000;
// rg flags added to the user's own rg config: show a preview of a minified or
// generated line instead of the whole line.
const RG_FLAGS = ['--max-columns=300', '--max-columns-preview'];

const TOOL = {
  name: 'bash',
  description:
    `Run a bash script${WIN ? ' (Git Bash)' : ''} and return its combined stdout and stderr when it finishes. ` +
    `Each call starts a fresh shell in ${CWD.replace(/\\/g, '/')}. ` +
    `Multi-line scripts and heredocs work. Use forward slashes in paths. ` +
    `The command runs in the foreground until it exits or timeout_ms passes ` +
    `(default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash script to run.' },
      timeout_ms: { type: 'integer', description: `Timeout in milliseconds (max ${MAX_TIMEOUT_MS}).` },
    },
    required: ['command'],
    additionalProperties: false,
  },
};

let seq = 0;

/**
 * Kill bash and everything it started. MSYS children are not in bash's Windows
 * process tree, so `taskkill /T` alone leaves them running; killing the MSYS
 * process group (bash's own `$$`) reaches them.
 */
function killTree(pid, pidFile) {
  if (!WIN) {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
    return;
  }
  let msysPid = '';
  try { msysPid = readFileSync(pidFile, 'utf8').trim(); } catch { /* not written yet */ }
  if (/^\d+$/.test(msysPid) && existsSync(MSYS_KILL)) {
    spawn(MSYS_KILL, ['-9', '--', `-${msysPid}`], { stdio: 'ignore', windowsHide: true });
  }
  spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
}

/**
 * @param {string} command
 * @param {number} timeoutMs
 * @returns {Promise<{ text: string, isError: boolean }>}
 */
function runBash(command, timeoutMs) {
  mkdirSync(OUT_DIR, { recursive: true });
  const id = `${process.pid}-${Date.now()}-${++seq}`;
  const script = join(OUT_DIR, `${id}.sh`);
  const pidFile = join(OUT_DIR, `${id}.pid`);
  writeFileSync(script, command, 'utf8');
  return new Promise((resolve) => {
    const chunks = [];
    let timedOut = false;
    let done = false;
    // Record bash's MSYS pid for killTree, define `apply-patch`, then run the
    // script with no arguments.
    const boot =
      'echo $$ > "$1"; __agy_ap=$3; apply-patch() { node "$__agy_ap" "$@"; }; ' +
      '__agy_script=$2; set --; . "$__agy_script"';
    const child = spawn(BASH, ['-c', boot, 'bash', pidFile.replace(/\\/g, '/'), script.replace(/\\/g, '/'), APPLY_PATCH], {
      cwd: CWD,
      env: RG_CONFIG ? { ...process.env, RIPGREP_CONFIG_PATH: RG_CONFIG } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: !WIN,
    });
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid, pidFile);
      // Stop waiting for pipes a surviving process may still hold.
      setTimeout(() => finish(null, null), 2000).unref();
    }, timeoutMs);
    const finish = (code, err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      for (const f of [script, pidFile]) try { unlinkSync(f); } catch { /* ignore */ }
      const out = Buffer.concat(chunks).toString('utf8');
      if (err) return resolve({ text: `Failed to start ${BASH}: ${err.message}`, isError: true });
      if (timedOut) return resolve({ text: `${out}\n[timed out after ${timeoutMs} ms; process killed]`, isError: true });
      resolve({ text: code === 0 ? out : `${out}\n[exit code ${code}]`, isError: false });
    };
    child.on('error', (err) => finish(null, err));
    child.on('close', (code) => finish(code, null));
  });
}

/**
 * Contents of the files an apply-patch call will update, read before it runs. The patch
 * is the heredoc in the command, or the file after --file. Paths resolve against CWD.
 * @param {string} command
 * @returns {Map<string, string> | null}
 */
function snapshotPatchTargets(command) {
  if (!command.includes('apply-patch')) return null;
  let text = command;
  const file = command.match(/--file\s+("[^"]+"|'[^']+'|\S+)/)?.[1].replace(/^["']|["']$/g, '');
  if (file) try { text += '\n' + readFileSync(resolve(CWD, file.replace(/^~(?=\/)/, homedir())), 'utf8'); } catch { /* not readable yet */ }
  const snap = new Map();
  for (const m of text.matchAll(/^\*\*\* Update: (.+?)\s*$/gm)) {
    const abs = resolve(CWD, m[1].replace(/\\/g, '/'));
    if (!snap.has(abs)) try { snap.set(abs, readFileSync(abs, 'utf8')); } catch { /* apply-patch reports it */ }
  }
  return snap.size ? snap : null;
}

/**
 * The diff of what the call changed in each snapshotted file, so the model sees its edits
 * in context without spending a turn on `git diff`. Only this call's changes appear, not
 * the user's uncommitted work in the same file.
 * @param {Map<string, string>} snap
 * @param {string} id
 */
function patchDiff(snap, id) {
  const before = join(OUT_DIR, `${id}.before`);
  const parts = [];
  for (const [abs, old] of snap) {
    writeFileSync(before, old, 'utf8');
    const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--no-ext-diff', '-U3', '--', before, abs], { encoding: 'utf8', windowsHide: true });
    const hunks = (r.stdout ?? '').replace(/\r(?=\n)/g, '').split('\n');
    const at = hunks.findIndex((l) => l.startsWith('@@'));
    if (at >= 0) parts.push(`--- ${relative(CWD, abs).replace(/\\/g, '/') || abs}`, ...hunks.slice(at).filter((l, k, a) => l || k < a.length - 1));
  }
  try { unlinkSync(before); } catch { /* none written */ }
  if (!parts.length) return '';
  const cut = parts.length > MAX_DIFF_LINES ? `\n[diff cut at ${MAX_DIFF_LINES} of ${parts.length} lines]` : '';
  return `\nDiff of the updated files (this call's changes only):\n${parts.slice(0, MAX_DIFF_LINES).join('\n')}${cut}\n`;
}

/**
 * The user's rg config plus any of RG_FLAGS it does not set, written to
 * OUT_DIR. Returns the user's own path when it already sets them all.
 * @returns {string | undefined}
 */
function rgConfig() {
  let own = '';
  try { own = readFileSync(process.env.RIPGREP_CONFIG_PATH ?? '', 'utf8'); } catch { /* none */ }
  const set = new Set(own.split('\n').map((l) => l.trim().split('=')[0]));
  const add = RG_FLAGS.filter((f) => !set.has(f.split('=')[0]));
  if (!add.length) return process.env.RIPGREP_CONFIG_PATH;
  const path = join(OUT_DIR, `ripgreprc-${process.pid}`);
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path, `${own.trimEnd()}\n${add.join('\n')}\n`.trimStart(), 'utf8');
    return path;
  } catch {
    return process.env.RIPGREP_CONFIG_PATH;
  }
}

/**
 * Shorten an over-long result, saving the full text where the note says.
 * When the command only prints a file, the note points at the file instead.
 * @param {string} text
 * @param {string} command
 */
function fitResult(text, command) {
  if (text.length <= BUDGET) return text;
  const target = readTarget(command);
  if (target) {
    const file = resolve(CWD, target.file).split(sep).join('/');
    if (existsSync(file)) return shorten(text, '', BUDGET, { read: { file, first: target.first } });
  }
  const saved = join(OUT_DIR, `${process.pid}-${Date.now()}-${++seq}.out`);
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(saved, text, 'utf8');
  } catch {
    return shorten(text, '(could not be saved)');
  }
  return shorten(text, saved.replace(/\\/g, '/'));
}

function pruneOutputs() {
  try {
    for (const f of readdirSync(OUT_DIR)) {
      if (!f.endsWith('.out') && !f.startsWith('ripgreprc-')) continue;
      const p = join(OUT_DIR, f);
      if (Date.now() - statSync(p).mtimeMs > KEEP_OUTPUT_MS) unlinkSync(p);
    }
  } catch { /* nothing to prune */ }
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notification
  switch (method) {
    case 'initialize':
      return send({ jsonrpc: '2.0', id, result: {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'agy-bash', version: '0.1.0' },
      } });
    case 'ping':
      return send({ jsonrpc: '2.0', id, result: {} });
    case 'tools/list':
      return send({ jsonrpc: '2.0', id, result: { tools: [TOOL] } });
    case 'tools/call': {
      if (params?.name !== TOOL.name) {
        return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
      }
      const command = String(params.arguments?.command ?? '');
      const t = Number(params.arguments?.timeout_ms) || DEFAULT_TIMEOUT_MS;
      const snap = snapshotPatchTargets(command);
      let { text, isError } = await runBash(command, Math.min(Math.max(t, 1000), MAX_TIMEOUT_MS));
      if (snap && !isError && /^ok: \d+ file/m.test(text)) text += patchDiff(snap, `${process.pid}-${++seq}`);
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: fitResult(text, command) || '(no output)' }], isError } });
    }
    default:
      return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

pruneOutputs();
const RG_CONFIG = rgConfig();
if (!existsSync(BASH)) process.stderr.write(`agy-bash: ${BASH} not found\n`);
if (!existsSync(APPLY_PATCH)) process.stderr.write(`agy-bash: ${APPLY_PATCH} not found\n`);
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  handle(msg).catch((e) => msg.id !== undefined && send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(e?.message ?? e) } }));
});
