import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseLine } from './parse.mjs';
import { modelCachePath } from './paths.mjs';
import { run, spawnDirect } from './run.mjs';

/** Max age, in days, before the weekly model-cache refresh trigger fires. */
const MODEL_CACHE_MAX_AGE_DAYS = 7;

/**
 * Longest message sent on stdin, in UTF-8 bytes. agy cuts a longer one short without
 * an error (a 324,000-char ASCII message kept about 191,000). That probe could not tell
 * bytes from characters, so the limit counts bytes, which is never less.
 */
export const MAX_STDIN_BYTES = 150_000;

/**
 * Format seconds as a Go duration for `--print-timeout` (`15m`, `1m30s`, `45s`).
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatPrintTimeout(seconds) {
  const n = Math.max(1, Math.round(Number(seconds) || 1));
  const m = Math.floor(n / 60);
  const s = n % 60;
  if (m > 0 && s === 0) return `${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

/**
 * The first message of a fresh job: the OS and workspace, whether the workspace is
 * a git repository, then the brief. `excludeDefaultComponents` drops agy's
 * `user_information` section, which gives stock agents the OS and workspace; without
 * it Hydrogen passed relative paths to `read_file`, which takes only absolute ones.
 * agy tells no agent the git fact, and on one-commit clones agents ran dozens of
 * `git log --grep` searches that could find nothing.
 *
 * @param {{workspace: string, isGit: boolean, history?: string, task: string}} opts
 * @returns {string}
 */
export function taskMessage({ workspace, isGit, history, task }) {
  const git = isGit ? (history ? `true (${history})` : 'true') : 'false';
  const ws = workspace.split(String.fromCharCode(92)).join('/');
  return `OS: Windows (shell: Git Bash, through the bash tool)\nWorkspace: ${ws}\nGit repository: ${git}\n\n# Task\n\n${task}`;
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
 * The agy plugin that carries the `bash-delegate` agent and its bash tool. agy names a
 * plugin's MCP tools `mcp_<plugin>_<server>_<tool>`, so the model sees
 * `mcp_agy_shell_bash` and `mcp_agy_shell_bash_bg`.
 */
export const PLUGIN_NAME = 'agy';
export const BASH_SERVER = 'shell';

/** What earlier versions put in agy's global config, removed once the plugin is in. */
const LEGACY_AGENTS = ['bash-delegate', 'agy-delegate', 'agy-chore'];
const LEGACY_BASH_SERVERS = ['agy', 'agybash'];

/** agy's global MCP config, read by every agy session. */
export function mcpConfigPath() {
  return join(homedir(), '.gemini', 'config', 'mcp_config.json');
}

/** Where `agy plugin install` puts the plugin. */
export function pluginDir() {
  return join(homedir(), '.gemini', 'config', 'plugins', PLUGIN_NAME);
}

/**
 * The bash server's entry, pointing at this checkout's `mcp/bash.mjs`, so an edit to
 * the bash tool is live without a reinstall. `timeoutSeconds` sits above bash.mjs's
 * 20-min cap so agy never cuts a call short; `eager` lists each tool directly instead
 * of behind `call_mcp_tool`, and `background: "always"` runs every `bash_bg` call as
 * an agy background task.
 *
 * @returns {object}
 */
export function bashServerEntry() {
  const script = fileURLToPath(new URL('../../mcp/bash.mjs', import.meta.url)).replace(/\\/g, '/');
  return {
    command: 'node',
    args: [script],
    timeoutSeconds: 1260,
    tools: { bash: { eager: true }, bash_bg: { eager: true, background: 'always' } },
  };
}

/**
 * The plugin's files, by path inside the plugin: `plugin.json`, `mcp_config.json`
 * and every agent in `agy-agents/`.
 *
 * @returns {Record<string, string>}
 */
export function pluginFiles() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const files = {
    'plugin.json': `${JSON.stringify({ name: PLUGIN_NAME, version, description: 'The bash-delegate agent and its bash tool, installed by the agy plugin for Claude Code.' }, null, 2)}\n`,
    'mcp_config.json': `${JSON.stringify({ mcpServers: { [BASH_SERVER]: bashServerEntry() } }, null, 2)}\n`,
  };
  for (const f of readdirSync(join(root, 'agy-agents'))) {
    if (f.endsWith('.md')) files[`agents/${f}`] = readFileSync(join(root, 'agy-agents', f), 'utf8');
  }
  return files;
}

/**
 * Install the plugin with `agy plugin install` when the installed copy is missing or
 * differs from `pluginFiles()`, then remove what earlier versions put in agy's global
 * config. agy copies a plugin on install, so a changed agent needs this before every
 * fresh dispatch; since 1.3.4 `--agent` with an unknown name fails the run.
 *
 * @param {string} bin
 * @returns {Promise<'installed'|'updated'|'unchanged'>}
 */
export async function installPlugin(bin) {
  const dest = pluginDir();
  const files = pluginFiles();
  const same = Object.entries(files).every(([rel, text]) => {
    try {
      return readFileSync(join(dest, rel), 'utf8') === text;
    } catch {
      return false;
    }
  });
  let state = 'unchanged';
  if (!same) {
    state = existsSync(dest) ? 'updated' : 'installed';
    const stage = mkdtempSync(join(tmpdir(), 'agy-plugin-'));
    try {
      for (const [rel, text] of Object.entries(files)) {
        mkdirSync(dirname(join(stage, rel)), { recursive: true });
        writeFileSync(join(stage, rel), text, 'utf8');
      }
      const res = await run(bin, ['plugin', 'install', stage], { timeoutMs: 60_000 });
      if (res.exitCode !== 0) {
        throw new Error(`agy plugin install failed: ${`${res.stderr}${res.stdout}`.trim() || `exit ${res.exitCode}`}`);
      }
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }
  removeLegacyInstall();
  return state;
}

/**
 * Remove the agent copies and bash server entries earlier versions wrote into agy's
 * global config, keeping every other server and key. Throws when the MCP config is
 * not valid JSON, rather than overwrite it.
 *
 * @param {string=} configPath
 * @returns {string[]} what was removed
 */
export function removeLegacyInstall(configPath = mcpConfigPath()) {
  const removed = [];
  const agents = join(homedir(), '.gemini', 'config', 'agents');
  for (const name of LEGACY_AGENTS) {
    const f = join(agents, `${name}.md`);
    if (existsSync(f)) {
      rmSync(f, { force: true });
      removed.push(`agents/${name}.md`);
    }
  }
  if (!existsSync(configPath)) return removed;
  const raw = readFileSync(configPath, 'utf8');
  if (!raw.trim()) return removed;
  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${configPath} is not valid JSON, left it unchanged: ${err.message}`);
  }
  const servers = config?.mcpServers;
  if (!servers || typeof servers !== 'object') return removed;
  const legacy = LEGACY_BASH_SERVERS.filter((name) => name in servers);
  if (!legacy.length) return removed;
  for (const name of legacy) {
    delete servers[name];
    removed.push(`mcp server ${name}`);
  }
  const tmp = `${configPath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  renameSync(tmp, configPath);
  return removed;
}

/**
 * @typedef {Object} BuildArgsInput
 * @property {string=} addDir              Absolute workspace path. Mandatory on fresh.
 * @property {number=} printTimeoutSec
 * @property {string=} logFile
 * @property {string=} model
 * @property {string=} agent               Custom agent name; fresh dispatch only
 *                                         (a resumed conversation keeps its agent).
 * @property {boolean=} sandbox
 * @property {string=} conversationId      Resume a specific conversation.
 * @property {boolean=} continueLatest     Resume agy's most recent conversation
 *                                         in this workspace.
 */

/**
 * Build agy's argv.
 *
 * Fresh dispatch passes the workspace as `--add-dir`. Resume omits `--add-dir` and specifies `--conversation <uuid>` or `--continue`.
 *
 * The message goes on stdin (`--input-format stream-json`), which `runHeadless`
 * closes after one line; agy exits once that turn ends. `--disable-slash-commands`
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
  const args = ['--output-format', 'stream-json', '--input-format', 'stream-json', '--disable-slash-commands'];
  if (!isResume) {
    args.push('--add-dir', opts.addDir);
  }
  // No --timeout means no limit: agy's own default (0) waits for the turn to end.
  if (opts.printTimeoutSec > 0) {
    args.push('--print-timeout', formatPrintTimeout(opts.printTimeoutSec));
  }
  if (opts.logFile) args.push('--log-file', opts.logFile);
  if (opts.model) args.push('--model', opts.model);
  if (opts.agent && !isResume) args.push('--agent', opts.agent);
  args.push('--dangerously-skip-permissions');
  if (opts.sandbox) args.push('--sandbox');
  if (isResume) {
    if (opts.conversationId) args.push('--conversation', opts.conversationId);
    else args.push('--continue');
  }
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
 * location, `%LOCALAPPDATA%\agy\bin\agy.exe`.
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
  const fallback = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'agy', 'bin', 'agy.exe');
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
 * weekly or rejected-model refresh in `delegate.mjs`. Null
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
 * `refreshModelCache`'s weekly and rejected-model triggers.
 *
 * @param {ModelInfo[]} models
 * @param {string|null} [toolVersion] raw `agy --version` output
 * @param {string|null} [bin] resolved agy binary path, so the next
 *   `resolveBin()` can skip `where` while it still exists on disk
 * @returns {void}
 */
export function writeModelCache(models, toolVersion, bin) {
  try {
    const path = modelCachePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({ fetchedAt: new Date().toISOString(), toolVersion: toolVersion ?? null, bin: bin ?? null, models }, null, 2)}\n`,
      'utf8',
    );
  } catch {
    // Non-fatal: the cache only feeds the model list and the version stamp.
  }
}

/**
 * Refresh the model cache in-process: fetch the live model list and
 * `agy --version`, then overwrite `models.json`. This also stamps
 * `toolVersion`, so `cachedToolVersion()` stays current without a separate
 * `agy --version` call anywhere else.
 *
 * `delegate.mjs` calls this weekly after a run and right after agy rejects a
 * model, always awaited in the same process, never detached.
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
  writeModelCache(models, versionText, bin);
  return models;
}

/**
 * @typedef {Object} DelegateOpts
 * @property {string[]} args
 * @property {string=} cwd
 * @property {string=} input               Written to stdin, which is then closed.
 * @property {(ev: Record<string, unknown>) => void=} onEvent
 * @property {(pid: number) => void=} onSpawn
 */

/**
 * @typedef {Object} DelegateResult
 * @property {number} exitCode
 * @property {Record<string, unknown>[]} events
 * @property {string[]} stderr   Last STDERR_TAIL_LINES lines agy wrote to stderr.
 */
/** Number of trailing stderr lines retained in the job record. */
export const STDERR_TAIL_LINES = 20;

/**
 * Spawn agy in headless mode. Writes `opts.input` to stdin and closes it:
 * with `--input-format stream-json` agy runs a turn per line and exits only
 * when stdin ends. Without input, stdin is ignored.
 * Parses stdout into JSON events; agy's brain transcript is the run's record.
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

  /** @type {Record<string, unknown>[]} */
  const events = [];
  /**
   * Rolling tail of agy's stderr for early failures (bad flags, unauthenticated,
   * unknown model) that exit without emitting a `result` event.
   * @type {string[]}
   */
  const stderr = [];

  const stdoutLines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const stderrLines = createInterface({ input: child.stderr, crlfDelay: Infinity });
  const stdoutDrained = once(stdoutLines, 'close');
  const stderrDrained = once(stderrLines, 'close');
  stdoutLines.on('line', (line) => {
    const ev = parseLine(line);
    if (!ev) return;
    events.push(ev);
    if (opts.onEvent) opts.onEvent(ev);
  });
  stderrLines.on('line', (line) => {
    if (line.trim().length === 0) return;
    stderr.push(line);
    if (stderr.length > STDERR_TAIL_LINES) stderr.shift();
  });

  const exitCode = await new Promise((resolve) => {
    let settled = false;
    const done = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    child.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      // Record spawn failure message in stderr so callers have context for
      // synthetic exit code 127 (not an agy 0/1/2 code).
      stderr.push(`spawn failed: ${message}`);
      done(127);
    });
    child.on('close', (code) => {
      done(typeof code === 'number' ? code : 1);
    });
  });

  await Promise.all([stdoutDrained, stderrDrained]);
  return { exitCode, events, stderr };
}
