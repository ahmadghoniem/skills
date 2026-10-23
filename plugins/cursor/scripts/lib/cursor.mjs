import { once } from 'node:events';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { killTree } from './killtree.mjs';
import { parseLine } from './parse.mjs';
import { pluginHome } from './paths.mjs';
import { run, spawnDirect } from './run.mjs';
import { defaultWindowsBin } from './winbin.mjs';

/** Files copied from the user's home before each run; everything else there stays hidden. */
const HOME_FILES = [join('.cursor', 'cli-config.json'), '.gitconfig'];

/**
 * The home folder a run gets, `~/.ccd/cursor-home`. Cursor has no switch for
 * the user-level context it loads (skills under `~/.claude`, `~/.agents` and
 * `~/.cursor`, the hooks in `~/.claude/settings.json`, Cursor user rules), so
 * the run is pointed at a home that has none of it. The login is not stored in
 * the home folder. `cli-config.json` is copied so the model and settings follow
 * the user's, and `.gitconfig` so git in Cursor's shell keeps the user's config.
 *
 * @param {string} [realHome]
 * @returns {string}
 */
export function runHome(realHome = homedir()) {
  const home = join(pluginHome(), 'cursor-home');
  mkdirSync(join(home, '.cursor'), { recursive: true });
  for (const file of HOME_FILES) {
    const from = join(realHome, file);
    if (existsSync(from)) copyFileSync(from, join(home, file));
  }
  return home;
}

/**
 * The version in `cursor-agent --version` output, e.g. `2026.10.22-27dcf5f`.
 * Kept whole, hash included: two builds of the same day differ only there.
 * Null when there is none.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function parseVersion(text) {
  const m = /(\d{4}\.\d{1,2}\.\d{1,2}(?:-[0-9a-f]+)?)/i.exec(String(text ?? ''));
  return m ? m[1] : null;
}

/**
 * Parse `cursor-agent models` output into a list of model ids.
 *
 *   Available models
 *
 *   auto - Auto (current, default)
 *   composer-2.5 - Composer 2.5
 *
 * @param {string} stdout
 * @returns {{id: string, label: string}[]}
 */
export function parseModelList(stdout) {
  const out = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9][\w.:-]*)\s+-\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ id: m[1], label: m[2] });
  }
  return out;
}

/** @type {string|null} */
let cachedBin = null;

/** For tests: forget the resolved binary. */
export function resetBinCache() {
  cachedBin = null;
}

/**
 * Find the Cursor CLI. Order: `CURSOR_AGENT_BIN`, then the Windows installer's
 * `%LOCALAPPDATA%\cursor-agent\cursor-agent.cmd`, then `cursor-agent` on PATH.
 *
 * The bare name `agent` is never looked up. Cursor installs it as an alias,
 * and so does Grok Build (`~/.grok/bin/agent.exe`); whichever comes first on
 * PATH wins, and on the machine this was built on that was grok.
 *
 * The installer path comes before PATH because the installer appends its
 * folder to the persistent user PATH, which a Claude Code session started
 * beforehand does not see.
 *
 * @returns {Promise<string>}
 */
export async function resolveBin() {
  if (cachedBin) return cachedBin;
  const override = process.env.CURSOR_AGENT_BIN?.trim();
  if (override) {
    cachedBin = override;
    return cachedBin;
  }
  const installed = defaultWindowsBin();
  if (installed) {
    cachedBin = installed;
    return cachedBin;
  }
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const res = await run(finder, ['cursor-agent'], { timeoutMs: 5_000 });
  const hit = res.stdout.split(/\r?\n/).find((line) => line.trim());
  if (res.exitCode === 0 && hit) {
    cachedBin = hit.trim();
    return cachedBin;
  }
  throw new Error(
    'cursor-agent not found at %LOCALAPPDATA%\\cursor-agent or on PATH. Install the Cursor CLI, or set CURSOR_AGENT_BIN to its full path.',
  );
}

/**
 * Longest brief passed on the command line. Windows caps a whole command line
 * at 32,767 characters; a longer brief is written to a file and the delegate
 * is told to read it.
 */
export const PROMPT_INLINE_MAX = 24_000;

/**
 * The prompt cursor-agent receives: the brief itself, or, when it is too long
 * for the command line, an instruction to read it from `promptFile`.
 *
 * @param {string} prompt
 * @param {string} promptFile
 * @returns {string}
 */
export function promptArg(prompt, promptFile) {
  if (prompt.length <= PROMPT_INLINE_MAX) return prompt;
  return `Your task is in the file ${promptFile}. Read all of it with your Read tool, then carry it out.`;
}

/**
 * @typedef {Object} BuildArgsInput
 * @property {string} prompt
 * @property {string=} model         Omitted: cursor-agent uses the account default.
 * @property {string=} chatId        Pre-assigned UUID for a NEW chat.
 * @property {string=} resumeChatId
 */

/**
 * Build cursor-agent's argv for a headless dispatch.
 *
 * `--force` is unconditional. Without it a print-mode run cannot run shell
 * commands or write files, because nobody can answer the approval prompt.
 * The guard against a bad edit is that this plugin never commits and a person
 * reads the diff.
 *
 * `--disable-auto-update` (hidden in `--help`, present in 2026.10.22) stops a
 * dispatch from updating the CLI in the background, so the version moves only
 * through `/cursor:update`.
 *
 * `--new-session-id <uuid>` (also hidden) names the chat before the run
 * starts, so a run killed before its `result` event can still be resumed.
 *
 * `--resume <chatId>` always names its chat. Bare `--resume` and `--continue`
 * pick the newest chat in the directory, which may belong to someone else.
 *
 * `--` ends the options, so a brief that starts with `-` is not read as a flag.
 *
 * Not passed: `--trust` (a print-mode run does not prompt for workspace trust,
 * and passing it loads no less context), `--approve-mcps`, `--model` unless
 * the user named one, and `--stream-partial-output` (without it each
 * `assistant` event is one whole message).
 *
 * @param {BuildArgsInput} opts
 * @returns {string[]}
 */
export function buildArgs(opts) {
  const args = ['-p', '--output-format', 'stream-json', '--force', '--disable-auto-update'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.resumeChatId) args.push('--resume', opts.resumeChatId);
  else if (opts.chatId) args.push('--new-session-id', opts.chatId);
  args.push('--', opts.prompt);
  return args;
}

/**
 * @typedef {Object} DelegateOpts
 * @property {string} prompt
 * @property {string=} model
 * @property {string=} chatId
 * @property {string=} resumeChatId
 * @property {string=} cwd
 * @property {number=} timeoutSec
 * @property {string} logPath
 * @property {(ev: Record<string, unknown>) => void=} onEvent
 * @property {(pid: number) => void=} onSpawn  cursor-agent's pid, as soon as it exists.
 */

/**
 * @typedef {Object} DelegateResult
 * @property {number} exitCode
 * @property {Record<string, unknown>[]} events
 * @property {boolean} killed
 * @property {string[]} stderrTail  Last few stderr lines, plus any spawn error.
 */

/**
 * Escalate to SIGKILL when the child has not actually exited. Node sets
 * `child.killed` when a signal is sent, not when the process exits.
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

/** How long cursor-agent may stay up after its `result` event. */
export const POST_RESULT_GRACE_MS = 10_000;

/**
 * @param {DelegateOpts} opts
 * @returns {Promise<DelegateResult>}
 */
export async function runHeadless(opts) {
  const bin = await resolveBin();
  // Kept next to the run's NDJSON log: when a run goes wrong the first
  // question is "what exactly did we ask?"
  const promptFile = `${opts.logPath}.prompt.txt`;
  writeFileSync(promptFile, opts.prompt, 'utf8');

  const args = buildArgs({
    prompt: promptArg(opts.prompt, promptFile),
    model: opts.model,
    chatId: opts.chatId,
    resumeChatId: opts.resumeChatId,
  });
  const home = runHome();
  const child = spawnDirect(bin, args, {
    cwd: opts.cwd ?? process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: home, USERPROFILE: home },
    // Mandatory on Windows: a dispatch from a backgrounded Bash call has no
    // console, and without this the OS opens a new terminal window for the
    // child that stays up for the whole run.
    windowsHide: true,
    // Not detached: the child stays in libuv's job object so `taskkill /T`
    // can walk the tree.
  });
  if (!child.stdout || !child.stderr) {
    throw new Error('cursor-agent spawn failed: stdout/stderr not attached');
  }
  if (typeof child.pid === 'number' && child.pid > 0 && opts.onSpawn) {
    opts.onSpawn(child.pid);
  }

  const logStream = createWriteStream(opts.logPath, { flags: 'a' });
  // A failed log write must not crash the process and orphan a running
  // cursor-agent; degrade to in-memory only.
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
  // cursor-agent explains a refused run on stderr only: a model the plan does
  // not allow ends with `ActionRequiredError: …`, exit 1 and no `result`
  // event. Kept to a tail because only the end of stderr is the reason.
  /** @type {string[]} */
  const stderrTail = [];
  const STDERR_TAIL_MAX = 20;
  const keepStderr = (line) => {
    const text = line.trim();
    if (!text) return;
    stderrTail.push(text);
    if (stderrTail.length > STDERR_TAIL_MAX) stderrTail.shift();
  };
  let killed = false;
  let reapedAfterResult = false;
  let postResultTimer;

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
    // Older builds sent `result` and then did not exit. The run is over at
    // that point, so a process still up after the grace period is reaped
    // without marking the run killed.
    if (ev.type === 'result' && !postResultTimer) {
      postResultTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null && typeof child.pid === 'number') {
          reapedAfterResult = true;
          logSafe('# plugin: cursor-agent still running after its result event; reaped\n');
          void killTree(child.pid, { graceMs: 2_000 });
          setTimeout(() => escalateSigkill(child), 2_000);
        }
      }, POST_RESULT_GRACE_MS);
    }
  });

  stderrLines.on('line', (line) => {
    logSafe(`# stderr: ${line}\n`);
    keepStderr(line);
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

  let exitCode = await new Promise((resolve) => {
    let settled = false;
    const done = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    // Without an 'error' handler a spawn failure emits an uncaught exception.
    child.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      logSafe(`# spawn error: ${message}\n`);
      keepStderr(`spawn error: ${message}`);
      done(127);
    });
    child.on('close', (code) => {
      done(typeof code === 'number' ? code : 1);
    });
  });

  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (postResultTimer) clearTimeout(postResultTimer);
  if (reapedAfterResult && !killed) exitCode = 0;
  await Promise.all([stdoutDrained, stderrDrained]);
  await new Promise((resolve) => {
    try {
      logStream.end(() => resolve());
    } catch {
      resolve();
    }
  });
  return { exitCode, events, killed, stderrTail };
}

/**
 * Cheap health probe: is the binary present and does it answer `--version`?
 *
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
export async function versionInfo() {
  try {
    const bin = await resolveBin();
    const res = await run(bin, ['--version'], { timeoutMs: 10_000 });
    const text = `${res.stdout}${res.stderr}`.trim();
    return { ok: res.exitCode === 0, detail: text || '(no output)' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * @typedef {Object} About
 * @property {string|null} cliVersion
 * @property {string|null} latestStatus   `up_to_date`, `update_available`, `disabled` or `unavailable`
 * @property {string|null} latestVersion
 * @property {string|null} model          the account default, as a display name
 * @property {string|null} subscriptionTier
 */

/**
 * `cursor-agent about --format json`, reduced to the fields the plugin uses.
 * The user's email is in the same document and is deliberately dropped.
 * Null when the command fails or prints no JSON.
 *
 * @returns {Promise<About|null>}
 */
export async function aboutInfo() {
  try {
    const bin = await resolveBin();
    const res = await run(bin, ['about', '--format', 'json'], { timeoutMs: 20_000 });
    if (res.exitCode !== 0) return null;
    const start = res.stdout.indexOf('{');
    if (start < 0) return null;
    const doc = JSON.parse(res.stdout.slice(start));
    const str = (v) => (typeof v === 'string' && v ? v : null);
    return {
      cliVersion: str(doc.cliVersion),
      latestStatus: str(doc.latestStatus),
      latestVersion: str(doc.latestVersion),
      model: str(doc.model),
      subscriptionTier: str(doc.subscriptionTier),
    };
  } catch {
    return null;
  }
}
