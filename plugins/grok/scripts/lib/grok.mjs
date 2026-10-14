import { once } from 'node:events';
import { createWriteStream, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { killTree } from './killtree.mjs';
import { parseLine } from './parse.mjs';
import { run, spawnDirect } from './run.mjs';

/**
 * The reasoning efforts a dispatch accepts. The xAI plan this was built on
 * allows only `low` and `medium`, so `high` is not offered.
 *
 * @type {readonly string[]}
 */
export const EFFORTS = Object.freeze(['low', 'medium']);

export const DEFAULT_EFFORT = 'medium';

/**
 * Set on every run. grok is the delegatee: the brief carries what it needs, so
 * the user's global Claude Code and Cursor agents, hooks, MCP servers, rules and
 * skills only add context and side effects. Claude Code plugins have no per-run
 * switch; they are disabled in `~/.grok/config.toml` instead.
 */
export const COMPAT_OFF_ENV = Object.freeze(
  Object.fromEntries(
    ['CLAUDE', 'CURSOR'].flatMap((vendor) =>
      ['AGENTS', 'HOOKS', 'MCPS', 'RULES', 'SKILLS'].map((kind) => [
        `GROK_${vendor}_${kind}_ENABLED`,
        'false',
      ]),
    ),
  ),
);

/**
 * Built-in tools removed from every headless run. Each one either needs a
 * person at the terminal (questions, plan approval, feedback), outlives the
 * run (schedules), or produces media no task asked for. The read, write,
 * search, shell and web tools stay.
 *
 * @type {readonly string[]}
 */
export const DISALLOWED_TOOLS = Object.freeze([
  'image_gen',
  'image_edit',
  'image_to_video',
  'reference_to_video',
  'ask_user_question',
  'enter_plan_mode',
  'exit_plan_mode',
  'send_feedback',
  'scheduler_create',
  'scheduler_delete',
  'scheduler_list',
]);

/**
 * The version number in `grok --version` output, e.g. `1.0.52` from
 * `grok 1.0.52 (abc1234 2026-10-01) [stable]`. Null when there is none.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function parseVersion(text) {
  const m = /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(String(text ?? ''));
  return m ? m[1] : null;
}

/**
 * Parse `grok models` output into a list of model ids.
 *
 * The command prints an auth line and the account default, then a bulleted list:
 *
 *   You are logged in with grok.com.
 *
 *   Default model: grok-4.6
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

/** @type {string|null} */
let cachedBin = null;

/**
 * Where the Grok installer puts the CLI, if it is there.
 *
 * The installer appends its directory to the *persistent* user PATH, which a
 * Claude Code session started beforehand will not have picked up — so a
 * `where grok` miss does not mean grok is absent. Checking this path directly
 * is what makes the plugin work in an already-running session.
 *
 * @returns {string|null}
 */
export function defaultGrokBin() {
  const candidate = join(homedir(), '.grok', 'bin', 'grok.exe');
  return existsSync(candidate) ? candidate : null;
}

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
  const res = await run('where', ['grok'], { timeoutMs: 5_000 });
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
    'grok not found on PATH or at %USERPROFILE%\\.grok\\bin. Install the Grok CLI, or set GROK_BIN to its full path.',
  );
}

/**
 * @typedef {Object} BuildArgsInput
 * @property {string} promptFile      Path to the file holding the brief.
 * @property {string=} model          Omitted: grok uses the account default.
 * @property {string=} effort         Passed through to `--reasoning-effort`.
 * @property {string=} sessionId        Pre-assigned UUID for a NEW session.
 * @property {string=} resumeSessionId
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
 * `-s <uuid>` names the session BEFORE the run starts, on fresh dispatches only.
 * Without it the id arrives only on the terminal `end` event, so a killed,
 * crashed, or truncated run was permanently unresumable — the one case where you
 * most want to resume. Verified on grok 1.0.5: a run killed mid-stream with no
 * `end` event still leaves `~/.grok/sessions/<cwd>/<uuid>` on disk, and
 * `-r <uuid>` resumes it with full prior context. On 1.0.52 `--resume <uuid>`
 * keeps the same session id.
 *
 * `-s` is illegal on a resume (it declares a NEW conversation).
 *
 * `--no-plan` and `--disallowed-tools` remove what a headless run cannot use;
 * see `DISALLOWED_TOOLS`. Checked on 1.0.52: every listed tool drops out of
 * the run's `available_commands`.
 *
 * `--trust` is deliberately absent. Without it a headless run skips the repo's
 * `AGENTS.md`/`CLAUDE.md`, MCP servers, hooks and skills (checked on 1.0.52
 * with a codeword in each file), so grok sees only the brief, and Claude puts
 * in it what the task needs. The home-level Claude and Cursor config is
 * switched off separately; see `COMPAT_OFF_ENV`.
 *
 * `--continue` is deliberately absent. It means "the most recent session for this
 * directory", which grok resolves by looking at the directory rather than at who
 * dispatched — so two Claude sessions in one repo, or a `grok` TUI opened on the
 * side, silently attach to each other's conversation and answer confidently from
 * the wrong context. Every resume names its session outright; the caller resolves
 * which one before getting here.
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
    '--no-plan',
    '--disallowed-tools',
    DISALLOWED_TOOLS.join(','),
  ];
  // Without `-m` grok applies the account default `grok models` prints, so a
  // new xAI model takes effect without a plugin change.
  if (opts.model) args.push('-m', opts.model);
  if (opts.effort) args.push('--reasoning-effort', opts.effort);
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
  else if (opts.sessionId) args.push('-s', opts.sessionId);
  return args;
}

/**
 * @typedef {Object} DelegateOpts
 * @property {string} prompt
 * @property {string=} model
 * @property {string=} effort
 * @property {string=} sessionId
 * @property {string=} resumeSessionId
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
 * @property {string[]} stderrTail  Last few stderr lines, plus any spawn error.
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
    sessionId: opts.sessionId,
    resumeSessionId: opts.resumeSessionId,
  });
  const child = spawnDirect(bin, args, {
    cwd: opts.cwd ?? process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...COMPAT_OFF_ENV },
    // Mandatory on Windows. A dispatch launched from a backgrounded Bash call
    // has no console of its own, so without this the OS hands this child a brand
    // new one — on Win11 a Windows Terminal window titled with the CLI's exe
    // path, which opens on dispatch and sits there for the whole life of the
    // job. This is the spawn that was actually producing it.
    windowsHide: true,
    // Deliberately NOT detached: this child stays inside libuv's job object so
    // `taskkill /T` can walk the tree.
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
  // Grok explains a refused dispatch on stderr and nothing else — a bad session
  // id answers with `no session id or title matched "…"`, which used to reach
  // the log file and never the screen. Kept to a tail because stderr also
  // carries progress chatter on a healthy run, and only the end of it is ever
  // the reason a run stopped.
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
      const message = err instanceof Error ? err.message : String(err);
      logSafe(`# spawn error: ${message}\n`);
      // A spawn failure produces no stdout, no stderr and no events, so this
      // is the only place the reason exists. It joins the same tail rather
      // than getting a channel of its own.
      keepStderr(`spawn error: ${message}`);
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
  return { exitCode, events, killed, stderrTail };
}

/**
 * Cheap health probe: is the binary present and does it answer `--version`?
 *
 * Deliberately not an auth check. `grok models` does report auth state (it
 * prints "You are logged in with grok.com." — verified on 1.0.5, exit 0) and
 * `/grok:setup` uses it for exactly that, but it is a network round-trip.
 * Liveness and login are separate questions and this probe answers the cheap one.
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

