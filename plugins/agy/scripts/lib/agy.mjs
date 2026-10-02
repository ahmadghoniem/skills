import { once } from 'node:events';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { killTree } from './killtree.mjs';
import { parseLine } from './parse.mjs';
import { modelCachePath } from './paths.mjs';
import { run, spawnDirect } from './run.mjs';

export const DEFAULT_PRINT_TIMEOUT_SEC = 3600;
export const WATCHDOG_GRACE_SEC = 60;

/** Max age, in days, before the weekly model-cache refresh trigger fires. */
const MODEL_CACHE_MAX_AGE_DAYS = 7;

const SIDECAR_INSTRUCTION =
  'Read the file at %PATH% in full and carry out that task exactly.';

/**
 * Longest message sent on stdin. agy cuts a longer one short without an error
 * (a 324,000-char message kept about 191,000), so past this the message goes
 * to the sidecar file instead.
 */
export const MAX_STDIN_CHARS = 150_000;

/**
 * Default flash family. 3.8 used 1.4 to 3.2 times the input tokens of 3.7 on
 * the same replayed jobs, so 3.7 wins while agy lists it.
 */
export const PREFERRED_FLASH = 'gemini-3.7-flash';

/**
 * True when the model id already encodes an effort level. Sending `--effort`
 * alongside such an id fails immediately.
 *
 * @param {string|undefined} modelId
 * @returns {boolean}
 */
export function modelEncodesEffort(modelId) {
  return typeof modelId === 'string' && /-(low|medium|high)$/.test(modelId);
}

/**
 * A model id with any trailing `-low`/`-medium`/`-high` removed.
 *
 * @param {string} modelId
 * @returns {string}
 */
export function modelFamily(modelId) {
  return modelId.replace(/-(low|medium|high)$/, '');
}

/**
 * Map every family in `models` to the set of effort levels its ids carry.
 * A family with an empty set (e.g. `claude-opus-4-6-thinking`) has no
 * `--effort` levels at all — agy lists it as a single bare id.
 *
 * @param {ModelInfo[]} models
 * @returns {Map<string, Set<'low'|'medium'|'high'>>}
 */
export function familyLevels(models) {
  /** @type {Map<string, Set<string>>} */
  const map = new Map();
  for (const m of models ?? []) {
    const suffix = /-(low|medium|high)$/.exec(m.id)?.[1];
    const family = suffix ? modelFamily(m.id) : m.id;
    if (!map.has(family)) map.set(family, new Set());
    if (suffix) map.get(family).add(suffix);
  }
  return map;
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
 * Generate the `--print=` payload directing agy to read the sidecar file,
 * used only for a message too long for stdin. The sidecar file is written to
 * `~/.cad/jobs/<repo-hash>/<job>.prompt.md`, which is outside the directory
 * passed to `--add-dir`, and agy reads it anyway.
 *
 * @param {string} absPromptPath
 * @returns {string}
 */
export function sidecarPrint(absPromptPath) {
  return SIDECAR_INSTRUCTION.replace('%PATH%', absPromptPath);
}

/**
 * The first message of a fresh job: a short environment note, any files passed
 * with `--read`, then the brief. agy loads AGENTS.md and GEMINI.md itself but
 * not CLAUDE.md, so `rulesFile` names a CLAUDE.md for the agent to read.
 *
 * @param {{workspace: string, isGit: boolean, rulesFile?: string, files?: string, task: string}} opts
 * @returns {string}
 */
export function taskMessage({ workspace, isGit, rulesFile, files, task }) {
  let env = `Environment\n- Working directory: ${workspace.replace(/\\/g, '/')}\n- Git repository: ${isGit ? 'yes' : 'no'}`;
  if (rulesFile) env += `\n- Repository rules: ${rulesFile}; read it before you change anything.`;
  const parts = [env];
  if (files) parts.push(`# Files\n\n${files}`);
  parts.push(`# Task\n\n${task}`);
  return parts.join('\n\n');
}

/**
 * One stream-json input line carrying `text` as a user turn.
 *
 * @param {string} text
 * @returns {string}
 */
export function stdinLine(text) {
  return `${JSON.stringify({ event: 'user', message: { content: text } })}\n`;
}

/**
 * Copy one of the plugin's agy agents (`agy-agents/<name>.md`) into agy's
 * global agents folder when it is missing or differs. agy only finds custom
 * agents there, and `--agent` with an unknown name silently runs the default
 * agent, so this runs before every fresh dispatch.
 *
 * @param {string} name
 * @returns {void}
 */
export function installAgent(name) {
  const src = fileURLToPath(new URL(`../../agy-agents/${name}.md`, import.meta.url));
  const dest = join(homedir(), '.gemini', 'config', 'agents', `${name}.md`);
  const text = readFileSync(src, 'utf8');
  if (existsSync(dest) && readFileSync(dest, 'utf8') === text) return;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, text, 'utf8');
}

/**
 * Server name of the plugin's bash tool in agy's MCP config. agy names an MCP
 * tool `mcp_<server>_<tool>`, so the model sees `mcp_agy_bash`.
 */
export const BASH_SERVER = 'agy';

/** Earlier names of the same server, moved to `BASH_SERVER` on install. */
const LEGACY_BASH_SERVERS = ['agybash'];

/** agy's global MCP config, read by every agy session. */
export function mcpConfigPath() {
  return join(homedir(), '.gemini', 'config', 'mcp_config.json');
}

/**
 * The bash server's entry, pointing at this install's `mcp/bash.mjs`.
 * `timeoutSeconds` sits above bash.mjs's 20-min cap so agy never cuts a call
 * short; `eager` lists the tool directly instead of behind `call_mcp_tool`.
 *
 * @returns {object}
 */
export function bashServerEntry() {
  const script = fileURLToPath(new URL('../../mcp/bash.mjs', import.meta.url)).replace(/\\/g, '/');
  return {
    command: 'node',
    args: [script],
    timeoutSeconds: 1260,
    tools: { bash: { eager: true } },
  };
}

/**
 * Add or update the bash server in agy's global MCP config, keeping every
 * other server and any extra keys on the entry (such as `env`), and renaming
 * an entry left under a legacy name. Writes only
 * when something changed. Throws when the file exists but is not valid JSON,
 * rather than overwrite it.
 *
 * @param {string=} configPath
 * @returns {'added'|'updated'|'unchanged'}
 */
export function installBashServer(configPath = mcpConfigPath()) {
  let config = {};
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf8');
    if (raw.trim()) {
      try {
        config = JSON.parse(raw);
      } catch (err) {
        throw new Error(`${configPath} is not valid JSON, left it unchanged: ${err.message}`);
      }
    }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${configPath} is not a JSON object, left it unchanged`);
  }
  const servers =
    config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {};
  const legacy = LEGACY_BASH_SERVERS.filter((name) => name in servers);
  const prev = servers[BASH_SERVER] ?? servers[legacy[0]];
  const next = { ...(prev && typeof prev === 'object' ? prev : {}), ...bashServerEntry() };
  if (!legacy.length && prev && JSON.stringify(prev) === JSON.stringify(next)) return 'unchanged';
  const kept = { ...servers };
  for (const name of legacy) delete kept[name];
  config.mcpServers = { ...kept, [BASH_SERVER]: next };
  mkdirSync(dirname(configPath), { recursive: true });
  const tmp = `${configPath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  renameSync(tmp, configPath);
  return prev ? 'updated' : 'added';
}

/**
 * @typedef {Object} BuildArgsInput
 * @property {string=} addDir              Absolute workspace path. Mandatory on fresh.
 * @property {string=} print               `--print` text; omitted, the message
 *                                         goes on stdin as stream-json.
 * @property {number=} printTimeoutSec
 * @property {string=} logFile
 * @property {string=} model
 * @property {string=} effort
 * @property {string=} agent               Custom agent name; fresh dispatch only
 *                                         (a resumed conversation keeps its agent).
 * @property {boolean=} sandbox
 * @property {string=} conversationId      Resume a specific conversation.
 * @property {boolean=} continueLatest     Resume agy's most recent conversation
 *                                         in this workspace (agy 1.2.1+).
 */

/**
 * Build agy's argv.
 *
 * Fresh dispatch requires `--add-dir` (absolute) to root the session at the target
 * directory instead of defaulting to `~/.gemini/antigravity-cli/scratch` with
 * `status: SUCCESS`. (`--new-project` also binds the directory but creates throwaway
 * projects; `--project` binds neither paths nor IDs).
 *
 * Resume omits `--add-dir` and specifies `--conversation <uuid>` or `--continue`.
 *
 * The message goes on stdin (`--input-format stream-json`), which `runHeadless`
 * closes after one line; agy exits once that turn ends. With `opts.print` it
 * goes in `--print=<text>` instead, attached last. `--disable-slash-commands`
 * stops a message that starts with `/usage` or similar from running a command.
 *
 * @param {BuildArgsInput} opts
 * @returns {string[]}
 */
export function buildArgs(opts) {
  const isResume = Boolean(opts.conversationId || opts.continueLatest);
  if (!isResume && !opts.addDir) {
    throw new Error('--add-dir <absolute-path> is required for a fresh dispatch');
  }

  /** @type {string[]} */
  const args = ['--output-format', 'stream-json'];
  if (!opts.print) args.push('--input-format', 'stream-json');
  args.push('--disable-slash-commands');
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
  if (opts.agent && !isResume) args.push('--agent', opts.agent);
  args.push('--dangerously-skip-permissions');
  if (opts.sandbox) args.push('--sandbox');
  if (isResume) {
    if (opts.conversationId) args.push('--conversation', opts.conversationId);
    else args.push('--continue');
  }
  if (opts.print) args.push(`--print=${opts.print}`);
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
 * Pick the default model for the requested effort from `models`:
 * `PREFERRED_FLASH` at that effort when agy lists it, else the newest flash
 * model at that effort. Because agy encodes effort in the model ID (e.g.
 * `gemini-3.7-flash-low`), selecting the ID applies the effort level. When the
 * newest version lacks the requested effort, its highest-effort ID is selected.
 *
 * Falls back to the account default label, then the first model, or null if
 * empty.
 *
 * @param {ModelInfo[]} models
 * @param {string|null=} accountDefaultLabel
 * @param {'low'|'medium'|'high'=} effort
 * @returns {string|null}
 */
export function pickDefaultModel(models, accountDefaultLabel, effort = 'medium') {
  const list = Array.isArray(models) ? models : [];
  if (list.length === 0) return null;

  const preferred = list.find((m) => m.id === `${PREFERRED_FLASH}-${effort}`);
  if (preferred) return preferred.id;

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
 * Resolve the agy binary path. Precedence: `AGY_BIN`, the path stored in the
 * model cache (if it still exists on disk), PATH, then the default installer
 * location under `%LOCALAPPDATA%\agy\bin\agy.exe`.
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
  const stored = readModelCacheRaw()?.bin;
  if (typeof stored === 'string' && stored && existsSync(stored)) {
    cachedBin = stored;
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
 * Live model list from `agy models`.
 *
 * Makes a network request, 4 to 16 s measured. Throws rather than return a
 * partial list from a killed or failed fetch, which would be written over a
 * good cache.
 *
 * @returns {Promise<ModelInfo[]>}
 */
export async function listModels() {
  const bin = await resolveBin();
  const res = await run(bin, ['models'], { timeoutMs: 30_000 });
  const models = res.exitCode === 0 ? parseModelList(res.stdout) : [];
  if (models.length === 0) {
    throw new Error(`agy models failed: ${(res.stderr || res.stdout || (res.timedOut ? 'timed out' : 'no models listed')).trim()}`);
  }
  return models;
}

/**
 * Parsed model cache, or null on any read/parse failure.
 *
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
 * `agy --version` string saved by the last writer — `/agy:setup`, or the
 * weekly/cache-miss/rejected-model refresh in `delegate.mjs`. Null
 * when the cache predates this field or nothing has written it yet.
 *
 * @returns {string|null}
 */
export function cachedToolVersion() {
  const parsed = readModelCacheRaw();
  return typeof parsed?.toolVersion === 'string' ? parsed.toolVersion : null;
}

/**
 * Read the cached model list. Returns null when no cache file exists.
 *
 * A read here never auto-expires or refetches: `delegate.mjs` is responsible
 * for refreshing the cache (weekly, on a cache miss, and after agy rejects a
 * model — see `refreshModelCache`); this function only serves what is there.
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
 * Drives the weekly refresh trigger in `delegate.mjs`.
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
 * Overwrite the model cache. Written by `/agy:setup` and by
 * `refreshModelCache`'s weekly/cache-miss/rejected-model triggers.
 *
 * @param {ModelInfo[]} models
 * @param {string|null} [accountDefaultLabel]
 * @param {string|null} [toolVersion] raw `agy --version` output
 * @param {string|null} [bin] resolved agy binary path, so the next
 *   `resolveBin()` can skip `where` while it still exists on disk
 * @returns {void}
 */
export function writeModelCache(models, accountDefaultLabel, toolVersion, bin) {
  try {
    const path = modelCachePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({ fetchedAt: new Date().toISOString(), accountDefaultLabel: accountDefaultLabel ?? null, toolVersion: toolVersion ?? null, bin: bin ?? null, models }, null, 2)}\n`,
      'utf8',
    );
  } catch {
    // Non-fatal: write failure leaves the next dispatch to fall back to agy's
    // built-in default.
  }
}

/**
 * Resolve the model for an unpinned dispatch using only local cache.
 *
 * Does not throw or make network calls. Returns null to omit `--model` and
 * use agy's account default.
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
 * Refresh the model cache in-process: fetch the live model list, the account
 * default label, and `agy --version`, then overwrite `models.json`. This
 * also stamps `toolVersion`, so `cachedToolVersion()` stays current without a
 * separate `agy --version` call anywhere else.
 *
 * `delegate.mjs` calls this on three triggers — weekly after a run, before
 * dispatch when the requested `--model` is not cached, and right after agy
 * rejects a model — always awaited in the same process, never detached.
 * Throws on failure; callers that must not fail the run wrap it in
 * try/catch.
 *
 * @returns {Promise<ModelInfo[]>}
 */
export async function refreshModelCache() {
  const bin = await resolveBin();
  const [models, ver] = await Promise.all([
    listModels(),
    run(bin, ['--version'], { timeoutMs: 5_000 }),
  ]);
  const versionText = `${ver.stdout}${ver.stderr}`.trim() || null;
  writeModelCache(models, readAccountDefaultLabel(), versionText, bin);
  return models;
}

/**
 * @typedef {Object} DelegateOpts
 * @property {string[]} args
 * @property {string=} cwd
 * @property {number=} timeoutSec          Outer watchdog (print-timeout + 60s grace).
 * @property {string} logPath              NDJSON capture path.
 * @property {string=} input               Written to stdin, which is then closed.
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
/** Number of trailing stderr lines retained in the job record. */
export const STDERR_TAIL_LINES = 20;

/**
 * Terminate the direct child if taskkill did not: SIGKILL it when it has not
 * exited.
 *
 * Checks `exitCode` and `signalCode` because Node sets `child.killed`
 * when the signal is sent, not when the process terminates.
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
 * Spawn agy in headless mode. Writes `opts.input` to stdin and closes it:
 * with `--input-format stream-json` agy runs a turn per line and exits only
 * when stdin ends. Without input, stdin is ignored.
 * Appends stdout lines to `logPath` and parses JSON events.
 *
 * @param {DelegateOpts} opts
 * @returns {Promise<DelegateResult>}
 */
export async function runHeadless(opts) {
  const bin = await resolveBin();
  const child = spawnDirect(bin, opts.args, {
    cwd: opts.cwd ?? process.cwd(),
    stdio: [opts.input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    env: process.env,
    windowsHide: true,
  });
  if (!child.stdout || !child.stderr) {
    throw new Error('agy spawn failed: stdout/stderr not attached');
  }
  if (child.stdin) {
    // An agy that exits early (bad flag, failed spawn) closes the pipe first;
    // its own exit code and stderr report that, not this EPIPE.
    child.stdin.on('error', () => {});
    child.stdin.end(opts.input, 'utf8');
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
   * Rolling tail of agy's stderr for early failures (bad flags, unauthenticated,
   * unknown model) that exit without emitting a `result` event.
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
      // Record spawn failure message in stderr so callers have context for
      // synthetic exit code 127 (not an agy 0/1/2 code).
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
