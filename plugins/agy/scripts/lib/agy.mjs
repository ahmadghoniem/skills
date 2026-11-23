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
import { run, spawnDirect } from './shared/proc.mjs';
import { parseVersion } from './shared/release.mjs';

/**
 * Longest message sent on stdin, in UTF-8 bytes. agy cuts a longer one short without
 * an error (a 324,000-char ASCII message kept about 191,000). That probe could not tell
 * bytes from characters, so the limit counts bytes, which is never less.
 */
export const MAX_STDIN_BYTES = 150_000;

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
 * Build agy's argv.
 *
 * A fresh run passes the workspace as `--add-dir`: without it agy works in its own
 * scratch folder and still reports `SUCCESS`. A resume passes `--conversation <id>`
 * instead and keeps the conversation's agent. `--continue` is never used: it takes
 * the newest conversation, which may belong to another Claude session.
 *
 * The message goes on stdin (`--input-format stream-json`), which `runHeadless`
 * closes after one line; agy exits once that turn ends. `--disable-slash-commands`
 * stops a message that starts with `/usage` or similar from running a command.
 *
 * @param {{addDir?: string, model?: string, agent?: string, sandbox?: boolean, conversationId?: string}} opts
 * @returns {string[]}
 */
export function buildArgs(opts) {
  const isResume = Boolean(opts.conversationId);
  if (!isResume && !opts.addDir) {
    throw new Error('--add-dir <absolute-path> is required for a fresh dispatch');
  }
  const args = ['--output-format', 'stream-json', '--input-format', 'stream-json', '--disable-slash-commands'];
  if (!isResume) args.push('--add-dir', opts.addDir);
  if (opts.model) args.push('--model', opts.model);
  if (opts.agent && !isResume) args.push('--agent', opts.agent);
  args.push('--dangerously-skip-permissions');
  if (opts.sandbox) args.push('--sandbox');
  if (isResume) args.push('--conversation', opts.conversationId);
  return args;
}

/**
 * The environment agy runs with. `CLAUDECODE` is removed so a `claude` command
 * agy runs does not take itself for a nested Claude Code session and refuse to
 * start. `AGY_CLI_DISABLE_AUTO_UPDATE` keeps agy from updating itself mid-run,
 * behind the version check and `/agy:update`.
 */
export function childEnv(base = process.env) {
  const env = { ...base, AGY_CLI_DISABLE_AUTO_UPDATE: 'true' };
  delete env.CLAUDECODE;
  return env;
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
 * Resolve the agy binary path. Precedence: `AGY_BIN`, PATH, then the default
 * installer location, `%LOCALAPPDATA%\agy\bin\agy.exe`.
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
  const fallback = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'agy', 'bin', 'agy.exe');
  if (existsSync(fallback)) {
    cachedBin = fallback;
    return cachedBin;
  }
  throw new Error(
    `agy not found on PATH or at ${fallback}. Install the Antigravity CLI, or set AGY_BIN to its full path.`,
  );
}

/** The installed agy version, or null. */
export async function installedVersion() {
  try {
    const res = await run(await resolveBin(), ['--version'], { timeoutMs: 5_000 });
    return res.exitCode === 0 ? parseVersion(res.stdout + res.stderr) : null;
  } catch {
    return null;
  }
}

/**
 * Live model list from `agy models`, read only when agy rejects a model. Throws
 * when it fails or lists nothing.
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
 * @typedef {Object} DelegateOpts
 * @property {string[]} args
 * @property {string=} cwd
 * @property {string=} input               Written to stdin, which is then closed.
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
    env: childEnv(),
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
