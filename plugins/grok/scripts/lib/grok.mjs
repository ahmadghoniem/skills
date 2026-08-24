import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { killTree } from './killtree.mjs';
import { parseLine } from './parse.mjs';
import { ensureDir, pluginHome } from './paths.mjs';
import { run } from './run.mjs';
import { adaptWindowsBin, defaultGrokBin } from './winbin.mjs';

// Last-resort pin, used only when `grok models` cannot be read. Grok ships very
// few models (grok-4.6 and grok-4.5 as of 1.0.5), and the newest is the one we
// want — so the live list is consulted first and this constant exists purely so
// a broken/offline `grok models` still yields a runnable dispatch.
export const FALLBACK_MODEL = 'grok-4.6';

const MODELS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Rank a model id so "newest" is well-defined. `grok-4.6` → 40006.
 * Anything unparseable sorts last, so a weird id never beats a real one.
 *
 * @param {string} id
 * @returns {number}
 */
export function modelRank(id) {
  const m = /(\d+)\.(\d+)/.exec(id);
  if (!m) return -1;
  return Number(m[1]) * 10000 + Number(m[2]);
}

/**
 * Parse `grok models` output into a list of model ids.
 *
 * The command prints a short preamble (including, unhelpfully, "You are not
 * authenticated." even on a working install) followed by a bulleted list:
 *
 *   Available models:
 *     * grok-4.6 (default)
 *     - grok-4.5
 *
 * @param {string} stdout
 * @returns {string[]}
 */
export function parseModelList(stdout) {
  /** @type {string[]} */
  const ids = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*[*-]\s+(\S+)/.exec(line);
    if (m?.[1]) ids.push(m[1]);
  }
  return ids;
}

function modelsCachePath() {
  return join(pluginHome(), 'models.json');
}

function readModelsCache() {
  try {
    const raw = JSON.parse(readFileSync(modelsCachePath(), 'utf8'));
    if (!Array.isArray(raw?.models) || typeof raw.fetchedAt !== 'number') return null;
    if (Date.now() - raw.fetchedAt > MODELS_CACHE_TTL_MS) return null;
    return raw.models;
  } catch {
    return null;
  }
}

function writeModelsCache(models) {
  try {
    ensureDir(pluginHome());
    writeFileSync(modelsCachePath(), JSON.stringify({ fetchedAt: Date.now(), models }), 'utf8');
  } catch {
    // A cache that cannot be written is not worth failing a dispatch over.
  }
}

/** @type {string[]|null} */
let cachedModels = null;

/**
 * The models grok reports, newest first. Cached in-process and on disk for a
 * day so a dispatch does not pay for a subprocess every time.
 *
 * @returns {Promise<string[]>}
 */
export async function listModels() {
  if (cachedModels) return cachedModels;
  const fromDisk = readModelsCache();
  if (fromDisk) {
    cachedModels = fromDisk;
    return cachedModels;
  }
  try {
    const bin = await resolveBin();
    const res = await run(bin, ['models'], { timeoutMs: 10_000 });
    const ids = parseModelList(`${res.stdout}\n${res.stderr}`);
    if (ids.length > 0) {
      cachedModels = [...new Set(ids)].sort((a, b) => modelRank(b) - modelRank(a));
      writeModelsCache(cachedModels);
      return cachedModels;
    }
  } catch {
    // fall through to the pin
  }
  cachedModels = [FALLBACK_MODEL];
  return cachedModels;
}

/**
 * Resolve the model for a dispatch: an explicit `--model` wins verbatim,
 * otherwise the newest model grok reports.
 *
 * Deliberately not a hardcoded default. The cursor plugin carried a pinned
 * `composer-2.5-fast` claim in its docs that went stale the moment Cursor moved
 * on; asking the CLI keeps that from happening here.
 *
 * @param {string|undefined} input
 * @returns {Promise<string>}
 */
export async function resolveModel(input) {
  if (input && input.trim() !== '') return input.trim();
  const fromEnv = process.env.CGD_DEFAULT_MODEL?.trim();
  if (fromEnv) return fromEnv;
  const models = await listModels();
  return models[0] ?? FALLBACK_MODEL;
}

/** @type {string|null} */
let cachedBin = null;

/**
 * @returns {Promise<string>}
 */
export async function resolveBin() {
  if (cachedBin) return cachedBin;
  const override = process.env.GROK_BIN?.trim();
  if (override) {
    cachedBin = override;
    return cachedBin;
  }
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const res = await run(locator, ['grok'], { timeoutMs: 5_000 });
  const hit = res.stdout.split(/\r?\n/).find((line) => line.trim());
  if (res.exitCode === 0 && hit) {
    cachedBin = hit.trim();
    return cachedBin;
  }
  // The installer appends its directory to the *persistent* user PATH, so a
  // Claude Code session started before the install will not see it on PATH.
  // This is not a rare edge case — it is what happened on the machine this
  // plugin was developed on.
  const fallback = defaultGrokBin();
  if (fallback) {
    cachedBin = fallback;
    return cachedBin;
  }
  throw new Error(
    'grok not found on PATH or at ~/.grok/bin. Install the Grok CLI, or set GROK_BIN to its full path.',
  );
}

/**
 * @typedef {Object} BuildArgsInput
 * @property {string} promptFile      Path to the file holding the brief.
 * @property {string} model
 * @property {string=} effort         Passed through to `--reasoning-effort`.
 * @property {string=} resumeSessionId
 * @property {boolean=} resumeLatest
 */

/**
 * Build grok's argv for a headless dispatch.
 *
 * The brief goes via `--prompt-file`, never argv: it keeps the text out of the
 * host process list, sidesteps the OS argument-length cap, and means a brief
 * that happens to start with `-` cannot be read as a flag.
 *
 * `--always-approve` is unconditional. A headless run has no way to answer an
 * approval prompt, so without it grok simply stalls. The guard against a bad
 * edit is not a permission dialog nobody can see — it is that this plugin never
 * commits, and a human reads the diff.
 *
 * `--sandbox` is deliberately never passed. Grok accepts an unknown profile name
 * silently and runs anyway (verified: `--sandbox __invalid__` produced no error),
 * so it reads like a guarantee while providing none.
 *
 * @param {BuildArgsInput} opts
 * @returns {string[]}
 */
export function buildArgs(opts) {
  const args = [
    '--prompt-file',
    opts.promptFile,
    '--output-format',
    'streaming-json',
    '--always-approve',
    '--no-auto-update',
    '-m',
    opts.model,
  ];
  if (opts.effort) args.push('--reasoning-effort', opts.effort);
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
  else if (opts.resumeLatest) args.push('--continue');
  return args;
}

/**
 * @typedef {Object} DelegateOpts
 * @property {string} prompt
 * @property {string} model
 * @property {string=} effort
 * @property {string=} resumeSessionId
 * @property {boolean=} resumeLatest
 * @property {string=} cwd
 * @property {number=} timeoutSec
 * @property {string} logPath
 * @property {(ev: Record<string, unknown>) => void=} onEvent
 * @property {(pid: number) => void=} onSpawn  Grok child's pid, as soon as it exists.
 */

/**
 * @typedef {Object} DelegateResult
 * @property {number} exitCode
 * @property {Record<string, unknown>[]} events
 * @property {boolean} killed
 */

/**
 * Escalate to SIGKILL when the child has not actually exited.
 *
 * Node sets `child.killed` when a signal is *sent*, not when the process
 * exits, so gating on `!child.killed` after `child.kill('SIGTERM')` makes
 * the escalation dead. The production predicate is exit/signal codes.
 *
 * @param {import('node:child_process').ChildProcess} child
 */
export function escalateSigkill(child) {
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      // noop
    }
  }
}

/**
 * @param {DelegateOpts} opts
 * @returns {Promise<DelegateResult>}
 */
export async function runHeadless(opts) {
  const bin = await resolveBin();
  // Kept next to the run's NDJSON log rather than in a temp dir that gets swept:
  // when a run goes wrong the first question is always "what exactly did we ask?"
  const promptFile = `${opts.logPath}.prompt.txt`;
  writeFileSync(promptFile, opts.prompt, 'utf8');

  const args = buildArgs({
    promptFile,
    model: opts.model,
    effort: opts.effort,
    resumeSessionId: opts.resumeSessionId,
    resumeLatest: opts.resumeLatest,
  });
  const [spawnCmd, spawnArgs] = adaptWindowsBin(bin, args);
  const child = spawn(spawnCmd, spawnArgs, {
    cwd: opts.cwd ?? process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    // Mandatory on Windows. The background worker is detached and therefore has
    // no console of its own, so without this the OS hands this child a brand new
    // one — on Win11 a Windows Terminal window titled with the CLI's exe path,
    // which opens on dispatch and sits there for the whole life of the job. This
    // is the spawn that was actually producing it; the worker's own spawn only
    // sets the stage.
    windowsHide: true,
    // POSIX: own process group so killTree can signal `-pid`. Do not unref —
    // we still wait on 'close'. Windows: stay in libuv's job; taskkill /T
    // walks the tree instead. The background worker's detached+unref is a
    // separate spawn and must stay as it is.
    ...(process.platform === 'win32' ? {} : { detached: true }),
  });
  if (!child.stdout || !child.stderr) {
    throw new Error('grok spawn failed: stdout/stderr not attached');
  }
  if (typeof child.pid === 'number' && child.pid > 0 && opts.onSpawn) {
    opts.onSpawn(child.pid);
  }

  const logStream = createWriteStream(opts.logPath, { flags: 'a' });
  // A failed log write (ENOSPC/EACCES/missing dir) must not crash the process
  // and orphan a running grok — degrade to in-memory only.
  let logBroken = false;
  logStream.on('error', () => {
    logBroken = true;
  });
  const logSafe = (s) => {
    if (logBroken) return;
    try {
      logStream.write(s);
    } catch {
      logBroken = true;
    }
  };

  /** @type {Record<string, unknown>[]} */
  const events = [];
  let killed = false;

  const stdoutLines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const stderrLines = createInterface({ input: child.stderr, crlfDelay: Infinity });
  // Attach before waiting on the child so a close that races with our
  // await still resolves. Cheap insurance on top of child `'close'`
  // (which already fires after stdio ends).
  const stdoutDrained = once(stdoutLines, 'close');
  const stderrDrained = once(stderrLines, 'close');
  stdoutLines.on('line', (line) => {
    logSafe(line + '\n');
    const ev = parseLine(line);
    if (!ev) return;
    events.push(ev);
    if (opts.onEvent) opts.onEvent(ev);
  });

  stderrLines.on('line', (line) => {
    logSafe(`# stderr: ${line}\n`);
  });

  let timeoutHandle;
  const onTimeout = () => {
    killed = true;
    if (typeof child.pid === 'number') {
      void killTree(child.pid, { graceMs: 5_000 });
    }
    setTimeout(() => escalateSigkill(child), 5_000);
  };
  if (typeof opts.timeoutSec === 'number' && opts.timeoutSec > 0) {
    timeoutHandle = setTimeout(onTimeout, opts.timeoutSec * 1_000);
  }

  const exitCode = await new Promise((resolve) => {
    let settled = false;
    const done = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    // Without an 'error' handler a spawn failure (missing/non-executable binary)
    // emits an uncaught exception that kills the process.
    child.on('error', (err) => {
      logSafe(`# spawn error: ${err instanceof Error ? err.message : String(err)}\n`);
      done(127);
    });
    child.on('close', (code) => {
      done(typeof code === 'number' ? code : 1);
    });
  });

  if (timeoutHandle) clearTimeout(timeoutHandle);
  await Promise.all([stdoutDrained, stderrDrained]);
  await new Promise((resolve) => {
    try {
      logStream.end(() => resolve());
    } catch {
      resolve();
    }
  });
  return { exitCode, events, killed };
}

/**
 * Cheap health probe. `grok models` is NOT usable for this — it prints
 * "You are not authenticated." on a perfectly working authenticated install —
 * so this only reports whether the binary is present and answers `--version`.
 *
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
export async function versionInfo() {
  try {
    const bin = await resolveBin();
    const res = await run(bin, ['--version'], { timeoutMs: 5_000 });
    const text = `${res.stdout}${res.stderr}`.trim();
    return { ok: res.exitCode === 0, detail: text || '(no output)' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

