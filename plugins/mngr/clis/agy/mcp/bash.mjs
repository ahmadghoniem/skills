#!/usr/bin/env node
// A `bash` tool for agy, served over MCP stdio (newline-delimited JSON-RPC).
// agy's own run_command runs PowerShell and backgrounds anything over 10 s;
// this runs Git Bash in the foreground until the command ends
// or times out. `bash_bg` runs the same way; mcp_config.json marks it
// `"background": "always"`, so agy runs it as a background task and sends the
// agent its result when it ends. A `bash` command still running at its timeout
// is left running as a job, and `bash_bg` with that job returns the rest.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolvePaths } from './apply-patch.mjs';
import { summarizePatch } from './patch-summary.mjs';
import { BUDGET, readTarget, shorten } from './shorten.mjs';

// Git for Windows' bin/bash.exe is a launcher that sets up the environment below and
// then starts usr/bin/bash.exe, which adds about 25 ms to every call. Unless AGY_BASH
// names a shell, run usr/bin/bash.exe directly with the environment the launcher builds.
const GIT_ROOT = 'C:/Program Files/Git';
const DIRECT_BASH = `${GIT_ROOT}/usr/bin/bash.exe`;
const DIRECT = !process.env.AGY_BASH && existsSync(DIRECT_BASH);
const BASH = process.env.AGY_BASH || (DIRECT ? DIRECT_BASH : `${GIT_ROOT}/bin/bash.exe`);
const BASH_PROC_ENV = DIRECT ? gitBashEnv(process.env) : process.env;

/**
 * What Git's launcher does before starting bash: MSYSTEM and EXEPATH set outright,
 * PLINK_PROTOCOL and HOME only when unset, and <prefix>/bin, usr/bin and %HOME%/bin
 * put in front of PATH (duplicates included, as the launcher does).
 * @param {NodeJS.ProcessEnv} base
 */
function gitBashEnv(base) {
  const env = { ...base };
  // Windows env names are case-insensitive, but a copied object is not: reuse the
  // existing spelling (usually `Path`) so the child does not get two PATHs.
  const key = (name) => Object.keys(env).find((k) => k.toUpperCase() === name) ?? name;
  const root = GIT_ROOT.replace(/\//g, '\\');
  const prefix = ['mingw64', 'clangarm64', 'mingw32'].find((p) => existsSync(`${GIT_ROOT}/${p}/bin`)) ?? 'mingw64';
  env[key('MSYSTEM')] = prefix.toUpperCase();
  env[key('EXEPATH')] = `${root}\\bin`;
  if (!env[key('PLINK_PROTOCOL')]) env[key('PLINK_PROTOCOL')] = 'ssh';
  if (!env[key('HOME')]) {
    const drive = env[key('HOMEDRIVE')], path = env[key('HOMEPATH')];
    env[key('HOME')] = drive && path ? drive + path : env[key('USERPROFILE')];
  }
  const front = [`${root}\\${prefix}\\bin`, `${root}\\usr\\bin`];
  if (env[key('HOME')]) front.push(`${env[key('HOME')]}\\bin`);
  const pathKey = key('PATH');
  env[pathKey] = [...front, env[pathKey]].filter(Boolean).join(';');
  return env;
}
// apply-patch.mjs beside this file, a copy of the repo's tools/apply-patch, reached in
// scripts as the `apply-patch` function.
const APPLY_PATCH = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), 'apply-patch-partial.mjs').replace(/\\/g, '/');
// Git Bash's own kill.exe, which can signal an MSYS process group.
const MSYS_KILL = join(dirname(BASH).replace(/[\\/]usr[\\/]bin$|[\\/]bin$/i, ''), 'usr', 'bin', 'kill.exe');
// The workspace. agy starts a plugin's MCP server in the plugin's own folder, so
// unless AGY_BASH_CWD is set, the first root agy reports through roots/list wins.
let CWD = process.env.AGY_BASH_CWD || process.cwd();
let rootsAsked = 0;
let clientHasRoots = false;
let markRootsReady;
const rootsReady = new Promise((resolve) => { markRootsReady = resolve; });
const ROOTS_WAIT_MS = 3000;
const OUT_DIR = join(tmpdir(), 'agy-bash');
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 1_200_000;
// Full outputs of shortened results, kept for a week so the model can still read
// them in a resumed conversation.
const KEEP_OUTPUT_MS = 7 * 24 * 60 * 60 * 1000;
// rg flags added to the user's own rg config: show a preview of a minified or
// generated line instead of the whole line.
const RG_FLAGS = ['--max-columns=300', '--max-columns-preview'];

const TOOL = {
  name: 'bash',
  description:
    `Run a bash script (Git Bash) and return its combined stdout and stderr when it finishes. ` +
    `Each call starts a fresh shell in ${'{CWD}'}. ` +
    `Multi-line scripts and heredocs work. Use forward slashes in paths. ` +
    `The command runs in the foreground until it exits or timeout_ms passes ` +
    `(default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}). A command still running then ` +
    `keeps running as a job: you get its output so far and a job number to pass to bash_bg.`,
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash script to run.' },
      timeout_ms: { type: 'integer', description: `Timeout in milliseconds (max ${MAX_TIMEOUT_MS}).` },
      // agy asks for these two on its own tools, and the model sometimes adds
      // them here too. Accepted and ignored, so the call is not rejected.
      toolAction: { type: 'string', description: 'Ignored.' },
      toolSummary: { type: 'string', description: 'Ignored.' },
    },
    required: ['command'],
    additionalProperties: false,
  },
};

const BG_TOOL = {
  ...TOOL,
  name: 'bash_bg',
  description:
    `Start a long bash script (Git Bash) in ${'{CWD}'} as a background task. ` +
    `Returns at once so you can keep working; you are sent its combined output when it exits ` +
    `(or after timeout_ms, default and max ${MAX_TIMEOUT_MS}). ` +
    `Pass job instead of command to take over a command that bash left running at its timeout.`,
  inputSchema: {
    ...TOOL.inputSchema,
    properties: {
      ...TOOL.inputSchema.properties,
      job: { type: 'integer', description: 'Job number from a bash call that reached its timeout. Use instead of command.' },
    },
    required: [],
  },
};

const active = new Map();
// Commands that `bash` left running at its timeout, by job number, until bash_bg takes them.
const jobs = new Map();
let jobSeq = 0;

let seq = 0;

/**
 * Kill bash and everything it started. MSYS children are not in bash's Windows
 * process tree, so `taskkill /T` alone leaves them running; killing the MSYS
 * process group (bash's own `$$`) reaches them.
 */
function killTree(pid, pidFile) {
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
 * @param {boolean} handoff  At the timeout, leave the command running as a job instead of killing it.
 * @returns {Promise<{ text: string, isError: boolean }>}
 */
function runBash(command, timeoutMs, reqId, progressToken, handoff = false) {
  mkdirSync(OUT_DIR, { recursive: true });
  const id = `${process.pid}-${Date.now()}-${++seq}`;
  const script = join(OUT_DIR, `${id}.sh`);
  const pidFile = join(OUT_DIR, `${id}.pid`);
  writeFileSync(script, command, 'utf8');
  return new Promise((resolve) => {
    let chunks = [];
    let timedOut = false;
    let canceled = false;
    let done = false;
    let step = 0;
    // Who receives the result: this call, or after a handoff the bash_bg call that takes the job.
    let deliver = resolve;
    let owner = reqId;
    let token = progressToken;
    let limit = timeoutMs;
    let result = null;
    // Record bash's MSYS pid for killTree, define `apply-patch`, then run the
    // script with no arguments.
    const boot =
      'echo $$ > "$1"; __agy_ap=$3; apply-patch() { node "$__agy_ap" "$@"; }; ' +
      '__agy_script=$2; set --; . "$__agy_script"';
    const child = spawn(BASH, ['-c', boot, 'bash', pidFile.replace(/\\/g, '/'), script.replace(/\\/g, '/'), APPLY_PATCH], {
      cwd: CWD,
      env: RG_CONFIG ? { ...BASH_PROC_ENV, RIPGREP_CONFIG_PATH: RG_CONFIG } : BASH_PROC_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const onData = (d) => {
      chunks.push(d);
      const message = token === undefined ? '' : d.toString('utf8').trimEnd();
      if (message) send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: ++step, message } });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const cancel = () => {
      canceled = true;
      killTree(child.pid, pidFile);
      setTimeout(() => finish(null, null), 2000).unref();
    };
    if (reqId !== undefined) active.set(reqId, cancel);
    const kill = () => {
      timedOut = true;
      killTree(child.pid, pidFile);
      // Stop waiting for pipes a surviving process may still hold.
      setTimeout(() => finish(null, null), 2000).unref();
    };
    let timer = setTimeout(() => {
      if (!handoff || timeoutMs >= MAX_TIMEOUT_MS) return kill();
      // Return what the command printed so far and keep it running until bash_bg takes
      // the job, or until MAX_TIMEOUT_MS after it started.
      const job = ++jobSeq;
      const out = Buffer.concat(chunks).toString('utf8');
      chunks = [];
      if (owner !== undefined) active.delete(owner);
      deliver = null;
      owner = token = undefined;
      limit = MAX_TIMEOUT_MS;
      timer = setTimeout(kill, MAX_TIMEOUT_MS - timeoutMs);
      jobs.set(job, (callId, callToken, res) => {
        jobs.delete(job);
        if (result) return res(result);
        deliver = res;
        owner = callId;
        token = callToken;
        if (callId !== undefined) active.set(callId, cancel);
      });
      resolve({
        text: `${out}\n[still running after ${timeoutMs} ms, as job ${job}. Call bash_bg with {"job": ${job}} ` +
          `to be sent the rest of its output when it exits. To stop it, pass manage_task the id agy gives that background task; it does not take this job number.]`,
        isError: false,
      });
    }, timeoutMs);
    const finish = (code, err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (owner !== undefined) active.delete(owner);
      child.stdout.destroy();
      child.stderr.destroy();
      for (const f of [script, pidFile]) try { unlinkSync(f); } catch { /* ignore */ }
      const out = Buffer.concat(chunks).toString('utf8');
      if (err) result = { text: `Failed to start ${BASH}: ${err.message}`, isError: true };
      else if (canceled) result = { text: `${out}\n[canceled; process killed]`, isError: true };
      else if (timedOut) result = { text: `${out}\n[timed out after ${limit} ms; process killed]`, isError: true };
      else result = { text: code === 0 ? out : `${out}\n[exit code ${code}]`, isError: false };
      deliver?.(result);
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
/** A patch path as apply-patch resolves it in Git Bash (/tmp, /c/..., ~/ included). */
const where = (p) => resolvePaths([p], CWD, BASH_PROC_ENV).get(p);

function snapshotPatchTargets(command) {
  if (!command.includes('apply-patch')) return null;
  let text = command;
  const file = command.match(/--file\s+("[^"]+"|'[^']+'|\S+)/)?.[1].replace(/^["']|["']$/g, '');
  if (file) try { text += '\n' + readFileSync(where(file), 'utf8'); } catch { /* not readable yet */ }
  const snap = new Map();
  for (const m of text.matchAll(/^\*\*\* Update: (.+?)\s*$/gm)) {
    const abs = where(m[1].replace(/\\/g, '/'));
    if (!snap.has(abs)) try { snap.set(abs, readFileSync(abs, 'utf8')); } catch { /* apply-patch reports it */ }
  }
  return snap.size ? snap : null;
}

/**
 * Each patched file's text before and after the call, by the path as the patch wrote it,
 * for `summarizePatch`'s `+A/-B` counts. No git: the before text is the snapshot.
 * @param {Map<string, string>} snap
 * @returns {(path: string) => { before?: string, after?: string }}
 */
function patchContents(snap) {
  return (path) => {
    const abs = where(path.replace(/\\/g, '/'));
    let after;
    try { after = readFileSync(abs, 'utf8'); } catch { /* deleted or unreadable */ }
    return { before: snap.get(abs), after };
  };
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
  if (Buffer.byteLength(text, 'utf8') <= BUDGET) return text;
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

/** Ask agy for its workspace roots; the answer arrives as a response in handle(). */
function askRoots() {
  rootsAsked += 1;
  send({ jsonrpc: '2.0', id: `roots-${rootsAsked}`, method: 'roots/list' });
}

/** Use the first file root as the working directory. */
function setRoots(roots) {
  const root = Array.isArray(roots) && roots.find((r) => typeof r?.uri === 'string' && r.uri.startsWith('file:'));
  if (root) CWD = fileURLToPath(root.uri);
  markRootsReady();
}

/** The tool as listed, with the working directory filled in. */
function toolDef(tool) {
  return { ...tool, description: tool.description.replace('{CWD}', CWD.replace(/\\/g, '/')) };
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === undefined) {
    if (typeof id === 'string' && id.startsWith('roots-')) setRoots(msg.result?.roots);
    return;
  }
  if (method === 'notifications/cancelled') {
    active.get(params?.requestId)?.();
    return;
  }
  if (method === 'notifications/initialized' || method === 'notifications/roots/list_changed') {
    if (!process.env.AGY_BASH_CWD && clientHasRoots) askRoots();
    return;
  }
  if (id === undefined) return; // notification
  switch (method) {
    case 'initialize':
      clientHasRoots = Boolean(params?.capabilities?.roots);
      if (!clientHasRoots || process.env.AGY_BASH_CWD) markRootsReady();
      setTimeout(markRootsReady, ROOTS_WAIT_MS).unref();
      return send({ jsonrpc: '2.0', id, result: {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'agy-bash', version: '0.1.0' },
      } });
    case 'ping':
      return send({ jsonrpc: '2.0', id, result: {} });
    case 'tools/list':
      await rootsReady;
      return send({ jsonrpc: '2.0', id, result: { tools: [toolDef(TOOL), toolDef(BG_TOOL)] } });
    case 'tools/call': {
      const bg = params?.name === BG_TOOL.name;
      if (params?.name !== TOOL.name && !bg) {
        return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
      }
      await rootsReady;
      const job = Number(params.arguments?.job);
      if (bg && job) {
        const take = jobs.get(job);
        if (!take) return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `No job ${job} is waiting to be taken.` }], isError: true } });
        const { text, isError } = await new Promise((res) => take(id, params?._meta?.progressToken, res));
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: fitResult(text, '') || '(no output)' }], isError } });
      }
      const command = String(params.arguments?.command ?? '');
      if (!command.trim()) return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Pass command${bg ? ', or job from a bash call that reached its timeout' : ''}.` }], isError: true } });
      const t = Number(params.arguments?.timeout_ms) || (bg ? MAX_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
      const snap = snapshotPatchTargets(command);
      let { text, isError } = await runBash(command, Math.min(Math.max(t, 1000), MAX_TIMEOUT_MS), id, params?._meta?.progressToken, !bg);
      if (snap && !isError) text = summarizePatch(text, patchContents(snap));
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
