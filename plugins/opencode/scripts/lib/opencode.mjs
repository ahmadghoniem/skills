import { once } from 'node:events';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { killTree } from './killtree.mjs';
import { parseLine } from './parse.mjs';
import { modelCachePath } from './paths.mjs';
import { run, spawnDirect } from './run.mjs';

/** Default watchdog, in seconds. `opencode run` has no timeout flag of its own. */
export const DEFAULT_TIMEOUT_SEC = 3600;

/** Max age, in days, before the weekly model-cache refresh trigger fires. */
const MODEL_CACHE_MAX_AGE_DAYS = 7;

/** Number of trailing stderr lines retained in the job record. */
export const STDERR_TAIL_LINES = 20;

/**
 * What the positional message says when the real brief rides along as an
 * attached file. opencode reads `-f` attachments in full, so the message only
 * has to point at one.
 */
const SIDECAR_MESSAGE =
  'Carry out the task in the attached file exactly as written. Do not redesign it. ' +
  'Where it is silent, follow the closest existing pattern in the repository. ' +
  'Finish by reporting what you changed and anything you could not do.';

/**
 * @typedef {Object} BuildArgsInput
 * @property {string} promptPath        Absolute path to the brief. Attached with `-f`.
 * @property {string} model             `provider/model`. Always sent: see config.mjs.
 * @property {string=} variant          Provider-specific reasoning effort.
 * @property {string=} dir              Working directory for the run.
 * @property {string=} title            Session title.
 * @property {string=} sessionId        Resume this session.
 * @property {boolean=} continueLatest  Resume the most recent session instead.
 * @property {boolean=} fork            Fork the session being resumed.
 */

/**
 * Build opencode's argv.
 *
 * `--auto` is opencode's own approve-everything switch — the counterpart of
 * agy's `--dangerously-skip-permissions`, and the only way a headless run gets
 * through a task that edits files or runs commands. Its alternative,
 * `OPENCODE_PERMISSION` with `"ask"`, cannot work here: there is nobody to ask,
 * and the run would block until the watchdog killed it.
 *
 * `-f` is a yargs array flag, so it keeps eating bare tokens after its path
 * and swallows the message: `-f brief.md "do the thing"` fails with
 * `File not found: do the thing`, and `--file=brief.md "do the thing"` fails
 * the same way. A `--` separator before the message is what stops it, and is
 * the only form of the three that works. Verified on 1.18.31.
 *
 * @param {BuildArgsInput} opts
 * @returns {string[]}
 */
export function buildArgs(opts) {
  if (!opts.promptPath) throw new Error('a prompt file path is required');
  if (!opts.model) throw new Error('a model id is required');

  /** @type {string[]} */
  const args = ['run', '--format', 'json', '--auto', '--model', opts.model];
  if (opts.variant) args.push('--variant', opts.variant);
  if (opts.dir) args.push('--dir', opts.dir);
  if (opts.sessionId) args.push('--session', opts.sessionId);
  else if (opts.continueLatest) args.push('--continue');
  if (opts.fork && (opts.sessionId || opts.continueLatest)) args.push('--fork');
  if (opts.title) args.push('--title', opts.title);
  args.push('-f', opts.promptPath);
  args.push('--', SIDECAR_MESSAGE);
  return args;
}

/**
 * @typedef {Object} ModelInfo
 * @property {string} id
 * @property {string} provider
 * @property {boolean} free   Whether the id is one of opencode's `-free` entries.
 */

/**
 * Parse `opencode models` output: one `provider/model` id per line, where the
 * model half may itself contain slashes (`nebius/deepseek-ai/DeepSeek-V4.1-Flash`).
 * The provider is everything before the first slash.
 *
 * @param {string} stdout
 * @returns {ModelInfo[]}
 */
export function parseModelList(stdout) {
  /** @type {ModelInfo[]} */
  const models = [];
  const seen = new Set();
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const id = line.trim();
    if (!id || id.includes(' ') || !id.includes('/')) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      provider: id.slice(0, id.indexOf('/')),
      free: /-free$/.test(id),
    });
  }
  return models;
}

/** @type {string|null} */
let cachedBin = null;

/** Reset the cached binary path. Tests use this; production never needs it. */
export function resetBinCache() {
  cachedBin = null;
}

/**
 * Resolve the opencode binary. Precedence: `OPENCODE_BIN`, the path stored in
 * the model cache (while it still exists), then PATH.
 *
 * @returns {Promise<string>}
 */
export async function resolveBin() {
  if (cachedBin) return cachedBin;
  const override = process.env.OPENCODE_BIN?.trim();
  if (override) {
    cachedBin = override;
    return cachedBin;
  }
  const stored = readModelCacheRaw()?.bin;
  if (typeof stored === 'string' && stored && existsSync(stored)) {
    cachedBin = stored;
    return cachedBin;
  }
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const res = await run(finder, ['opencode'], { timeoutMs: 5_000 });
  const hit = res.stdout.split(/\r?\n/).find((line) => line.trim());
  if (res.exitCode === 0 && hit) {
    cachedBin = hit.trim();
    return cachedBin;
  }
  throw new Error(
    'opencode not found on PATH. Install it (`npm i -g opencode-ai`, `bun add -g opencode-ai`, or the installer at opencode.ai), then run `opencode auth login`. Set OPENCODE_BIN to override the lookup.',
  );
}

/**
 * A `.cmd` or `.bat` shim — what npm installs on Windows — is not an
 * executable image, so `CreateProcess` refuses it unless it goes through the
 * shell. bun's `opencode.exe` does not need this.
 *
 * @param {string} bin
 * @returns {boolean}
 */
export function needsShell(bin) {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(String(bin ?? ''));
}

/**
 * Live model list from `opencode models`.
 *
 * Throws rather than return a partial list, which would otherwise be written
 * over a good cache.
 *
 * @returns {Promise<ModelInfo[]>}
 */
export async function listModels() {
  const bin = await resolveBin();
  const res = await run(bin, ['models'], { timeoutMs: 60_000 });
  const models = res.exitCode === 0 ? parseModelList(res.stdout) : [];
  if (models.length === 0) {
    const why = (
      res.stderr ||
      res.stdout ||
      (res.timedOut ? 'timed out' : 'no models listed')
    ).trim();
    throw new Error(`opencode models failed: ${why}`);
  }
  return models;
}

/**
 * @returns {Record<string, unknown>|null}
 */
function readModelCacheRaw() {
  try {
    return JSON.parse(readFileSync(modelCachePath(), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * `opencode --version` as recorded by the last cache write.
 *
 * @returns {string|null}
 */
export function cachedToolVersion() {
  const parsed = readModelCacheRaw();
  return typeof parsed?.toolVersion === 'string' ? parsed.toolVersion : null;
}

/**
 * The cached model list, or null when nothing has been cached yet. Reading
 * never refetches; `delegate.mjs` owns the refresh triggers.
 *
 * @returns {ModelInfo[]|null}
 */
export function cachedModels() {
  const parsed = readModelCacheRaw();
  if (!Array.isArray(parsed?.models)) return null;
  return parsed.models;
}

/**
 * True when the cache has no `fetchedAt`, or it is older than `maxAgeDays`.
 *
 * @param {number} [maxAgeDays]
 * @returns {boolean}
 */
export function modelCacheStale(maxAgeDays = MODEL_CACHE_MAX_AGE_DAYS) {
  const parsed = readModelCacheRaw();
  const fetchedAt = typeof parsed?.fetchedAt === 'string' ? Date.parse(parsed.fetchedAt) : NaN;
  if (!Number.isFinite(fetchedAt)) return true;
  return Date.now() - fetchedAt > maxAgeDays * 24 * 60 * 60 * 1000;
}

/**
 * Overwrite the model cache.
 *
 * @param {ModelInfo[]} models
 * @param {string|null} [toolVersion]
 * @param {string|null} [bin]
 * @returns {void}
 */
export function writeModelCache(models, toolVersion, bin) {
  try {
    const path = modelCachePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          fetchedAt: new Date().toISOString(),
          toolVersion: toolVersion ?? null,
          bin: bin ?? null,
          models,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  } catch {
    // Non-fatal. A failed write only costs the next command a refetch.
  }
}

/**
 * Fetch the live model list and `opencode --version`, then overwrite the
 * cache. Throws on failure; callers that must not fail a run wrap it.
 *
 * @returns {Promise<ModelInfo[]>}
 */
export async function refreshModelCache() {
  const bin = await resolveBin();
  const [models, ver] = await Promise.all([
    listModels(),
    run(bin, ['--version'], { timeoutMs: 10_000 }),
  ]);
  const versionText = `${ver.stdout}${ver.stderr}`.trim() || null;
  writeModelCache(models, versionText, bin);
  return models;
}

/**
 * @typedef {Object} DelegateOpts
 * @property {string[]} args
 * @property {string=} cwd
 * @property {number=} timeoutSec        Watchdog. opencode has no timeout flag.
 * @property {string} logPath            NDJSON capture path.
 * @property {(ev: Record<string, unknown>) => void=} onEvent
 * @property {(pid: number) => void=} onSpawn
 */

/**
 * @typedef {Object} DelegateResult
 * @property {number} exitCode
 * @property {Record<string, unknown>[]} events
 * @property {boolean} killed
 * @property {string[]} stderr
 */

/**
 * Terminate the direct child if taskkill did not.
 *
 * Checks `exitCode` and `signalCode` because Node sets `child.killed` when the
 * signal is sent, not when the process terminates.
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
 * Spawn opencode headless. stdin is closed so a prompt-for-input can never
 * wedge the run; stdout is appended to `logPath` line by line and parsed.
 *
 * @param {DelegateOpts} opts
 * @returns {Promise<DelegateResult>}
 */
export async function runHeadless(opts) {
  const bin = await resolveBin();
  const child = spawnDirect(bin, opts.args, {
    cwd: opts.cwd ?? process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    windowsHide: true,
    shell: needsShell(bin),
  });
  if (!child.stdout || !child.stderr) {
    throw new Error('opencode spawn failed: stdout/stderr not attached');
  }
  if (typeof child.pid === 'number' && child.pid > 0 && opts.onSpawn) {
    opts.onSpawn(child.pid);
  }

  const logStream = createWriteStream(opts.logPath, { flags: 'a' });
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
  /** @type {string[]} */
  const stderr = [];
  let killed = false;

  const stdoutLines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const stderrLines = createInterface({ input: child.stderr, crlfDelay: Infinity });
  const stdoutDrained = once(stdoutLines, 'close');
  const stderrDrained = once(stderrLines, 'close');
  stdoutLines.on('line', (line) => {
    logSafe(`${line}\n`);
    const ev = parseLine(line);
    if (!ev) return;
    events.push(ev);
    if (opts.onEvent) opts.onEvent(ev);
  });
  stderrLines.on('line', (line) => {
    logSafe(`# stderr: ${line}\n`);
    if (line.trim().length === 0) return;
    stderr.push(line);
    if (stderr.length > STDERR_TAIL_LINES) stderr.shift();
  });

  let timeoutHandle;
  const onTimeout = () => {
    killed = true;
    if (typeof child.pid === 'number') {
      void killTree(child.pid, { taskkillTimeoutMs: 5_000 });
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
    child.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      logSafe(`# spawn error: ${message}\n`);
      stderr.push(`spawn failed: ${message}`);
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
  return { exitCode, events, killed, stderr };
}
