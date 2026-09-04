import { once } from 'node:events';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { killTree } from './killtree.mjs';
import { parseLine } from './parse.mjs';
import { modelCachePath } from './paths.mjs';
import { run, spawnDirect } from './run.mjs';

export const DEFAULT_PRINT_TIMEOUT_SEC = 900;
export const WATCHDOG_GRACE_SEC = 60;

const SIDECAR_INSTRUCTION =
  'Read the file at %PATH% in full and carry out that task exactly.';

/**
 * True when the model id already encodes an effort level. Sending `--effort`
 * alongside such an id fails immediately (F4).
 *
 * @param {string|undefined} modelId
 * @returns {boolean}
 */
export function modelEncodesEffort(modelId) {
  return typeof modelId === 'string' && /-(low|medium|high)$/.test(modelId);
}

/**
 * Format seconds as a Go duration for `--print-timeout` (`15m`, `1m30s`, `45s`).
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatPrintTimeout(seconds) {
  const n = Math.max(1, Math.round(Number(seconds) || DEFAULT_PRINT_TIMEOUT_SEC));
  const m = Math.floor(n / 60);
  const s = n % 60;
  if (m > 0 && s === 0) return `${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

/**
 * The `--print=` payload. The brief itself never goes on argv; agy is told
 * to read the sidecar file (which it can, even outside `--add-dir` — F8).
 *
 * @param {string} absPromptPath
 * @returns {string}
 */
export function sidecarPrint(absPromptPath) {
  return SIDECAR_INSTRUCTION.replace('%PATH%', absPromptPath);
}

/**
 * @typedef {Object} BuildArgsInput
 * @property {string=} addDir              Absolute workspace path. Mandatory on fresh.
 * @property {string} promptPath           Absolute sidecar path.
 * @property {number=} printTimeoutSec
 * @property {string=} logFile
 * @property {string=} model
 * @property {string=} effort
 * @property {boolean=} sandbox
 * @property {string=} conversationId      Resume a specific conversation (F7).
 * @property {boolean=} continueLatest     Resume most recent for the cwd (F7).
 */

/**
 * Build agy's argv.
 *
 * Fresh dispatch always includes `--add-dir` (absolute). That single flag is
 * what roots the session at the target directory: without it agy falls back to
 * the persistent default CLI project, whose root is
 * `~/.gemini/antigravity-cli/scratch` — it then writes there, leaves the repo
 * untouched, and still reports `status: SUCCESS`. `--new-project` binds the cwd
 * too, but it does the same job while creating a throwaway project on every
 * dispatch, so only `--add-dir` is sent.
 *
 * `--add-dir` and `--new-project` are the only flags that bind the cwd.
 * `--project` binds nothing and reports no error, given either an absolute path
 * or a real conversation id. `--continue` resumes the globally most recent
 * conversation rather than one matched to the directory, so it lands in scratch
 * unless the run it resumes was itself bound.
 *
 * Resume omits `--add-dir` and adds `--conversation <uuid>` or `--continue`.
 * `--print=<text>` is last.
 *
 * @param {BuildArgsInput} opts
 * @returns {string[]}
 */
export function buildArgs(opts) {
  const isResume = Boolean(opts.conversationId || opts.continueLatest);
  if (!isResume && !opts.addDir) {
    throw new Error('--add-dir <absolute-path> is required for a fresh dispatch');
  }
  if (!opts.promptPath) {
    throw new Error('sidecar prompt path is required');
  }

  /** @type {string[]} */
  const args = ['--output-format', 'stream-json'];
  if (!isResume) {
    args.push('--add-dir', opts.addDir);
  }
  args.push(
    '--print-timeout',
    formatPrintTimeout(opts.printTimeoutSec ?? DEFAULT_PRINT_TIMEOUT_SEC),
  );
  if (opts.logFile) args.push('--log-file', opts.logFile);
  if (opts.model) args.push('--model', opts.model);
  if (opts.effort && !modelEncodesEffort(opts.model)) {
    args.push('--effort', opts.effort);
  }
  args.push('--dangerously-skip-permissions');
  if (opts.sandbox) args.push('--sandbox');
  if (isResume) {
    if (opts.conversationId) args.push('--conversation', opts.conversationId);
    else args.push('--continue');
  }
  args.push(`--print=${sidecarPrint(opts.promptPath)}`);
  return args;
}

/**
 * @typedef {Object} ModelInfo
 * @property {string} id
 * @property {string} label
 */

/**
 * Parse `agy models` TSV (id TAB label) into a list. Stable and simple —
 * preferred over `agy --output-format json models`.
 *
 * @param {string} stdout
 * @returns {ModelInfo[]}
 */
export function parseModelList(stdout) {
  /** @type {ModelInfo[]} */
  const models = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tab = trimmed.indexOf('\t');
    if (tab === -1) continue;
    const id = trimmed.slice(0, tab).trim();
    const label = trimmed.slice(tab + 1).trim();
    if (id) models.push({ id, label });
  }
  return models;
}

const EFFORT_RANK = { high: 3, medium: 2, low: 1 };

/**
 * Numeric version embedded in a model id (`gemini-3.7-flash-high` -> 3.7).
 * Ids without one sort last.
 *
 * @param {string} id
 * @returns {number}
 */
function versionOf(id) {
  const m = /(\d+(?:\.\d+)*)/.exec(id);
  if (!m) return -1;
  const parts = m[1].split('.').map(Number);
  return parts[0] + (parts[1] ?? 0) / 1000 + (parts[2] ?? 0) / 1e6;
}

/**
 * The model to use when the caller did not pin one.
 *
 * Flash is the point of this plugin — cheap, fast, high volume — so the pick is
 * the newest flash id agy currently offers, resolved from the live `agy models`
 * list rather than hardcoded (the ids change).
 *
 * Effort is the caller's, not this function's. agy encodes it in the id
 * (`gemini-3.7-flash-low`), so choosing the model and choosing the effort are
 * the same act; picking `-high` here would make `--effort` unreachable on every
 * run that does not also pin `--model`. When the newest version does not offer
 * the requested level, its highest-ranked id stands in.
 *
 * Falls back to the account default, then the first model, then nothing.
 *
 * @param {ModelInfo[]} models
 * @param {string|null=} accountDefaultLabel
 * @param {'low'|'medium'|'high'=} effort
 * @returns {string|null}
 */
export function pickDefaultModel(models, accountDefaultLabel, effort = 'medium') {
  const list = Array.isArray(models) ? models : [];
  if (list.length === 0) return null;

  const flash = list.filter((m) => /flash/i.test(m.id));
  if (flash.length > 0) {
    const scored = flash
      .map((m) => {
        const suffix = /-(low|medium|high)$/.exec(m.id)?.[1];
        return { id: m.id, effort: suffix ? EFFORT_RANK[suffix] : 0, version: versionOf(m.id) };
      })
      .sort((a, b) => b.version - a.version || b.effort - a.effort || a.id.localeCompare(b.id));
    const newest = scored[0].version;
    const sameVersion = scored.filter((m) => m.version === newest);
    return (sameVersion.find((m) => m.id.endsWith(`-${effort}`)) ?? sameVersion[0]).id;
  }

  if (accountDefaultLabel) {
    const hit = list.find((m) => m.label === accountDefaultLabel);
    if (hit) return hit.id;
  }
  return list[0].id;
}

/**
 * Account default from `~/.gemini/antigravity-cli/settings.json` (`model` is
 * a display label, e.g. `Gemini 3.7 Flash (High)`).
 *
 * @returns {string|null}
 */
export function readAccountDefaultLabel() {
  const p = join(homedir(), '.gemini', 'antigravity-cli', 'settings.json');
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return typeof raw?.model === 'string' ? raw.model : null;
  } catch {
    return null;
  }
}

/** @type {string|null} */
let cachedBin = null;

/**
 * Reset the cached binary path. Tests use this; production never needs it.
 */
export function resetBinCache() {
  cachedBin = null;
}

/**
 * Resolve the agy binary. `AGY_BIN` wins; then PATH; then the installer
 * location on the persistent user PATH, which a session started before
 * install will not have picked up (F9).
 *
 * @returns {Promise<string>}
 */
export async function resolveBin() {
  if (cachedBin) return cachedBin;
  const override = process.env.AGY_BIN?.trim();
  if (override) {
    cachedBin = override;
    return cachedBin;
  }
  const res = await run('where', ['agy'], { timeoutMs: 5_000 });
  const hit = res.stdout.split(/\r?\n/).find((line) => line.trim());
  if (res.exitCode === 0 && hit) {
    cachedBin = hit.trim();
    return cachedBin;
  }
  const localApp = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  const fallback = join(localApp, 'agy', 'bin', 'agy.exe');
  if (existsSync(fallback)) {
    cachedBin = fallback;
    return cachedBin;
  }
  throw new Error(
    `agy not found on PATH or at ${fallback}. Install the Antigravity CLI, or set AGY_BIN to its full path.`,
  );
}

/**
 * Live model list from `agy models`. Never hardcoded.
 *
 * This is a network round-trip — `agy models` prints "Fetching available
 * models…" and takes ~2s. Nothing on the dispatch path may call it; use
 * `cachedModels()` there instead.
 *
 * @returns {Promise<ModelInfo[]>}
 */
export async function listModels() {
  const bin = await resolveBin();
  const res = await run(bin, ['models'], { timeoutMs: 10_000 });
  return parseModelList(res.stdout);
}

/**
 * The `agy --version` string as of the last `/agy:setup`, which is its only
 * writer. Null when the cache predates this field or setup has never run.
 *
 * @returns {string|null}
 */
export function cachedToolVersion() {
  try {
    const parsed = JSON.parse(readFileSync(modelCachePath(), 'utf8'));
    return typeof parsed?.toolVersion === 'string' ? parsed.toolVersion : null;
  } catch {
    return null;
  }
}

/**
 * Read the cached model list. Returns null when there is no cache yet.
 *
 * The cache never expires on its own, deliberately. A time-based refresh means
 * some unlucky dispatch pays the ~2s fetch, and which one is unpredictable —
 * exactly the friction this plugin exists to avoid. The list only changes when
 * Google ships a model, which is an event you know about, so refreshing is an
 * explicit act: `/agy:setup` rewrites this file.
 *
 * @returns {ModelInfo[]|null}
 */
export function cachedModels() {
  try {
    const raw = readFileSync(modelCachePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.models)) return null;
    return parsed.models;
  } catch {
    return null;
  }
}

/**
 * Overwrite the model cache. Only `/agy:setup` calls this.
 *
 * @param {ModelInfo[]} models
 * @param {string|null} [accountDefaultLabel]
 * @param {string|null} [toolVersion] raw `agy --version` output
 * @returns {void}
 */
export function writeModelCache(models, accountDefaultLabel, toolVersion) {
  try {
    const path = modelCachePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({ fetchedAt: new Date().toISOString(), accountDefaultLabel: accountDefaultLabel ?? null, toolVersion: toolVersion ?? null, models }, null, 2)}\n`,
      'utf8',
    );
  } catch {
    // A cache that cannot be written is not a reason to fail the command that
    // was actually asked for. The next dispatch just falls back to agy's own
    // default, which is the same behaviour as before any cache existed.
  }
}

/**
 * Resolve the model for a dispatch that did not pin one, from cache only.
 *
 * Never throws and never touches the network — a model list that cannot be read
 * is not a reason to refuse the job. Returning null means "pass no `--model`",
 * and agy then picks the account default on its own.
 *
 * @param {'low'|'medium'|'high'=} effort
 * @returns {string|null}
 */
export function resolveDefaultModel(effort = 'medium') {
  try {
    const models = cachedModels();
    if (models == null) return null;
    return pickDefaultModel(models, readAccountDefaultLabel(), effort);
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} DelegateOpts
 * @property {string[]} args
 * @property {string=} cwd
 * @property {number=} timeoutSec          Outer watchdog (print-timeout + 60s grace).
 * @property {string} logPath              NDJSON capture path.
 * @property {(ev: Record<string, unknown>) => void=} onEvent
 * @property {(pid: number) => void=} onSpawn
 */

/**
 * @typedef {Object} DelegateResult
 * @property {number} exitCode
 * @property {Record<string, unknown>[]} events
 * @property {boolean} killed
 * @property {string[]} stderr   Last STDERR_TAIL_LINES lines agy wrote to stderr.
 */

/**
 * How much stderr to keep. Enough for a stack-free error and its context; not so
 * much that a chatty run can push a job record to an unreasonable size.
 */
export const STDERR_TAIL_LINES = 20;

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
 * Spawn agy headless. stdin is ignored (a left-open stdin pipe historically
 * hung `agy -p`). Every stdout line is appended to `logPath` and parsed.
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
  });
  if (!child.stdout || !child.stderr) {
    throw new Error('agy spawn failed: stdout/stderr not attached');
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
  /**
   * Rolling tail of agy's stderr. This is where the whole "agy never got
   * started" class lives — not authenticated, unknown `--model`, bad flag — and
   * every one of those produces no `result` event, so without keeping the text
   * the caller has nothing but a bare exit code to explain itself with.
   * @type {string[]}
   */
  const stderr = [];
  let killed = false;

  const stdoutLines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const stderrLines = createInterface({ input: child.stderr, crlfDelay: Infinity });
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
    if (line.trim().length === 0) return;
    stderr.push(line);
    if (stderr.length > STDERR_TAIL_LINES) stderr.shift();
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
    child.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      logSafe(`# spawn error: ${message}\n`);
      // Spawn failed, so agy never ran and never wrote to stderr. Put the reason
      // where the caller looks for it, or the run reports a bare exit code that
      // names nothing: 127 is not one of agy's own codes (0/1/2), so it cannot
      // be looked up anywhere.
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

/**
 * @returns {Promise<{ok: boolean, detail: string, bin?: string}>}
 */
export async function versionInfo() {
  try {
    const bin = await resolveBin();
    const res = await run(bin, ['--version'], { timeoutMs: 5_000 });
    const text = `${res.stdout}${res.stderr}`.trim();
    return { ok: res.exitCode === 0, detail: text || '(no output)', bin };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
