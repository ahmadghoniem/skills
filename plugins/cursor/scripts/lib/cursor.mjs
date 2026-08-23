import { spawn } from 'node:child_process';
import { createWriteStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { killTree } from './killtree.mjs';
import { parseLine } from './parse.mjs';
import { run } from './run.mjs';
import { adaptWindowsBin, defaultWindowsBin } from './winbin.mjs';

// Convenience aliases for the handful of shortcuts stable enough to hardcode.
// Cursor rotates concrete per-vendor model ids constantly (this table used to
// carry ~40 entries like `grok` → `grok-4.3`, which went stale the moment
// Cursor shipped the next Grok build). Rather than chase that drift here,
// only the durable human shortcuts are hardcoded; every other id — including
// current, retired, or brand-new vendor ids — is passed through verbatim by
// `resolveModel()`. Runtime discovery (`listModels()`, grouped by
// `isCursorModel()`) is what keeps the invoking agent honest about what a
// given id actually is; see `commands/delegate.md` / `agents/cursor-runner.md`.
export const MODEL_ALIASES = {
  fast: 'composer-2.5-fast',
  composer: 'composer-2.5-fast',
  auto: 'auto',
};

// `auto` lets Cursor pick whatever model the account is entitled to —
// safe default for users without a paid Composer seat. Power users
// can override per-invocation via `--model <id>` or globally via the env var
// CCD_DEFAULT_MODEL.
export const DEFAULT_MODEL = 'auto';

/**
 * @returns {string}
 */
export function defaultModel() {
  const fromEnv = process.env.CCD_DEFAULT_MODEL;
  if (fromEnv && fromEnv.trim().length > 0) {
    const key = fromEnv.trim().toLowerCase();
    return MODEL_ALIASES[key] ?? fromEnv.trim();
  }
  return DEFAULT_MODEL;
}

/**
 * @param {string|undefined} input
 * @returns {string}
 */
export function resolveModel(input) {
  if (!input || input.trim() === '') return defaultModel();
  const key = input.trim().toLowerCase();
  return MODEL_ALIASES[key] ?? input.trim();
}

/** @type {string|null} */
let cachedBin = null;

/**
 * @returns {Promise<string>}
 */
export async function resolveBin() {
  if (cachedBin) return cachedBin;
  const override = process.env.CURSOR_AGENT_BIN?.trim();
  if (override && override.length > 0) {
    cachedBin = override;
    return cachedBin;
  }
  // `where` is the Windows equivalent of `which`; it reports one path per line.
  const locator = process.platform === 'win32' ? 'where' : 'which';
  for (const candidate of ['cursor-agent', 'agent']) {
    const res = await run(locator, [candidate]);
    const hit = res.stdout.split(/\r?\n/).find((line) => line.trim());
    if (res.exitCode === 0 && hit) {
      cachedBin = hit.trim();
      return cachedBin;
    }
  }
  // The Windows installer adds its dir to the *persistent* user PATH, so a
  // Claude Code session started beforehand will not see it. Look there directly.
  const winDefault = defaultWindowsBin();
  if (winDefault) {
    cachedBin = winDefault;
    return cachedBin;
  }
  throw new Error(
    'cursor-agent not found on PATH. Install from https://cursor.com/install or run /cursor:setup.',
  );
}

/**
 * Ordinary slash-command briefs stay on argv: the sidecar costs a cursor-agent
 * Read tool call and can dilute the instruction. 4 KiB sits well under both
 * the 8,191 cmd.exe and 32,767 CreateProcess ceilings after flags and the
 * binary path. Flag-like tokens (`-X`, `-ldflags`) always sidecar — PowerShell
 * `$args` re-splits those into a *wrong prompt* rather than an error.
 */
export const PROMPT_INLINE_MAX = 4096;

const PROMPT_FLAG_TOKEN = /(?:^|[\s"'`])-{1,2}[A-Za-z]/;

/**
 * @param {string} prompt
 * @returns {boolean}
 */
export function shouldSidecarPrompt(prompt) {
  return prompt.length > PROMPT_INLINE_MAX || PROMPT_FLAG_TOKEN.test(prompt);
}

/**
 * Node sets `subprocess.killed` when the signal is *sent*, not when the
 * process exits. Gating SIGKILL on `child.killed` skips the escalation
 * entirely. Use this instead (paperclip#8598).
 *
 * @param {{ exitCode: number|null, signalCode: string|null }} child
 * @returns {boolean}
 */
export function childStillRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Tree-kill a spawned CLI child if it has not actually exited.
 * `child.killed` is ignored — see `childStillRunning`.
 *
 * @param {{ pid?: number, exitCode: number|null, signalCode: string|null }} child
 * @param {{ graceMs?: number }} [opts]
 * @returns {Promise<'killed'|'already-gone'|'failed'>}
 */
export function reapChild(child, opts) {
  if (!childStillRunning(child)) return Promise.resolve('already-gone');
  if (typeof child.pid !== 'number' || child.pid <= 0) return Promise.resolve('failed');
  return killTree(child.pid, opts);
}

/**
 * @typedef {Object} BuildArgsInput
 * @property {string} prompt
 * @property {string} model
 * @property {string=} resumeChatId
 * @property {boolean=} resumeLatest
 * @property {boolean=} cloud
 * @property {boolean=} force              Default: true.
 * @property {boolean=} approveMcps
 * @property {string=} logPath             NDJSON log path; sidecar is `${logPath}.prompt.txt`.
 * @property {string=} promptFile          Explicit sidecar path (overrides logPath).
 */

/**
 * @param {string} path
 * @returns {string}
 */
function sidecarPointer(path) {
  return `Read the file at ${path} in full and carry out that task.`;
}

/**
 * @param {import('node:readline').Interface} rl
 * @returns {Promise<void>}
 */
function drainReadline(rl) {
  return new Promise((resolve) => {
    const finish = () => resolve();
    rl.once('close', finish);
    if (rl.closed) {
      rl.off('close', finish);
      resolve();
    }
  });
}

/**
 * @param {BuildArgsInput} opts
 * @returns {string[]}
 */
export function buildArgs(opts) {
  const args = ['-p', '--output-format', 'stream-json', '--trust', '--model', opts.model];
  if (opts.force !== false) args.push('--force');
  if (opts.approveMcps) args.push('--approve-mcps');
  if (opts.cloud) args.push('--cloud');
  if (opts.resumeChatId) args.push(`--resume=${opts.resumeChatId}`);
  else if (opts.resumeLatest) args.push('--resume');
  if (shouldSidecarPrompt(opts.prompt)) {
    const promptFile = opts.promptFile ?? (opts.logPath ? `${opts.logPath}.prompt.txt` : undefined);
    if (!promptFile) {
      throw new Error(
        'buildArgs: long or flag-like prompt needs logPath (or promptFile) for the sidecar',
      );
    }
    writeFileSync(promptFile, opts.prompt, 'utf8');
    args.push(sidecarPointer(promptFile));
  } else {
    args.push(opts.prompt);
  }
  return args;
}

/**
 * @typedef {Object} DelegateOpts
 * @property {string} prompt
 * @property {string} model
 * @property {string=} resumeChatId
 * @property {boolean=} resumeLatest
 * @property {boolean=} cloud
 * @property {boolean=} force
 * @property {boolean=} approveMcps
 * @property {string=} cwd
 * @property {number=} timeoutSec
 * @property {string} logPath
 * @property {(ev: Record<string, unknown>) => void=} onEvent
 * @property {(line: string) => void=} onRaw
 * @property {(pid: number) => void=} onSpawn
 */

/**
 * @typedef {Object} DelegateResult
 * @property {number} exitCode
 * @property {Record<string, unknown>[]} events
 * @property {boolean} killed
 */

/**
 * @param {DelegateOpts} opts
 * @returns {Promise<DelegateResult>}
 */
export async function runHeadless(opts) {
  const bin = await resolveBin();
  const args = buildArgs(opts);
  const [spawnCmd, spawnArgs] = adaptWindowsBin(bin, args);
  // POSIX: detached without unref() so cursor-agent is a process-group
  // leader and `killTree` can signal `-pid`. Do not detach on Windows —
  // libuv already assigns non-detached children to the process-wide job.
  // Do not unref: that is reserved for the background *worker*, which must
  // outlive the Claude session.
  const child = spawn(spawnCmd, spawnArgs, {
    cwd: opts.cwd ?? process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    ...(process.platform === 'win32' ? {} : { detached: true }),
  });
  if (typeof child.pid === 'number' && child.pid > 0 && opts.onSpawn) {
    opts.onSpawn(child.pid);
  }
  if (!child.stdout || !child.stderr) {
    throw new Error('cursor-agent spawn failed: stdout/stderr not attached');
  }
  const childStdout = child.stdout;
  const childStderr = child.stderr;
  const logStream = createWriteStream(opts.logPath, { flags: 'a' });
  // A failed log write (ENOSPC/EACCES/missing dir) must not crash the process
  // and orphan the running cursor-agent — degrade to in-memory only.
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
  let sawResult = false;
  let killed = false;

  const stdoutLines = createInterface({ input: childStdout, crlfDelay: Infinity });
  stdoutLines.on('line', (line) => {
    logSafe(line + '\n');
    if (opts.onRaw) opts.onRaw(line);
    const ev = parseLine(line);
    if (!ev) return;
    events.push(ev);
    if (opts.onEvent) opts.onEvent(ev);
    // Arm the post-result watchdog at most once — cursor-agent can emit
    // several `result` events, and re-arming would stack redundant timers.
    if (ev.type === 'result' && !sawResult) {
      sawResult = true;
      setTimeout(() => {
        if (childStillRunning(child)) {
          killed = true;
          reapChild(child, { graceMs: 5_000 }).catch(() => {});
        }
      }, 5_000);
    }
  });

  const stderrLines = createInterface({ input: childStderr, crlfDelay: Infinity });
  stderrLines.on('line', (line) => {
    logSafe(`# stderr: ${line}\n`);
  });

  let timeoutHandle;
  if (typeof opts.timeoutSec === 'number' && opts.timeoutSec > 0) {
    timeoutHandle = setTimeout(() => {
      killed = true;
      reapChild(child, { graceMs: 5_000 }).catch(() => {});
    }, opts.timeoutSec * 1_000);
  }

  const exitCode = await new Promise((resolve) => {
    let settled = false;
    const done = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    // Without an 'error' handler a spawn failure (missing/non-executable
    // binary) emits an uncaught exception that kills the process.
    child.on('error', (err) => {
      logSafe(`# spawn error: ${err instanceof Error ? err.message : String(err)}\n`);
      done(sawResult ? 0 : 1);
    });
    child.on('close', (code) => {
      done(typeof code === 'number' ? code : sawResult ? 0 : 1);
    });
  });
  // Cheap insurance: child `'close'` already waits for stdio to shut, but
  // await the readline interfaces too so the last NDJSON line cannot still
  // be in flight when we summarise.
  await Promise.all([drainReadline(stdoutLines), drainReadline(stderrLines)]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
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
 * @returns {Promise<{loggedIn: boolean, detail: string}>}
 */
export async function authStatus() {
  try {
    const bin = await resolveBin();
    const res = await run(bin, ['status'], { timeoutMs: 5_000 });
    const text = `${res.stdout}\n${res.stderr}`.toLowerCase();
    const loggedIn =
      res.exitCode === 0 &&
      (text.includes('logged in') || text.includes('authenticated') || text.includes('signed in'));
    return {
      loggedIn,
      detail: `${res.stdout}${res.stderr ? `\n${res.stderr}` : ''}`.trim(),
    };
  } catch (err) {
    return { loggedIn: false, detail: String(err) };
  }
}

/**
 * Cursor's own models are the ones included in the plan's "Cursor Models"
 * usage pool (Composer, Cursor Grok); everything else is metered per token
 * against the separate "Other Models" pool. Cursor namespaces its own ids
 * rather than versioning them into a list, so this stays correct across
 * `composer-3` / `cursor-grok-5` without a table to keep up to date.
 *
 * @param {string} id
 * @returns {boolean}
 */
export function isCursorModel(id) {
  return id.startsWith('composer') || id.startsWith('cursor-');
}

/**
 * Turn `cursor-agent models` output (`"<id> - <label>"` lines) into bare ids.
 *
 * @param {string[]} lines
 * @returns {string[]}
 */
export function parseModelList(lines) {
  const ids = [];
  for (const line of lines) {
    const [id] = line.split(' - ');
    const trimmed = (id ?? '').trim();
    // Skip headings and blank/tip lines — real entries always have a label.
    if (trimmed.length === 0 || !line.includes(' - ')) continue;
    if (trimmed.includes(' ')) continue;
    ids.push(trimmed);
  }
  return ids;
}

/**
 * The `-fast` sibling of a model, when the account actually offers one.
 * Roughly half the lineup has none (e.g. `claude-sonnet-5-*`, `gemini-*`),
 * so callers use this to decide whether asking about speed makes sense.
 *
 * @param {string} id
 * @param {string[]} ids   every id the account offers
 * @returns {string|undefined}
 */
export function fastVariant(id, ids) {
  if (id.endsWith('-fast')) return undefined;
  return ids.includes(`${id}-fast`) ? `${id}-fast` : undefined;
}

/**
 * @returns {Promise<string[]>}
 */
export async function listModels() {
  try {
    const bin = await resolveBin();
    const res = await run(bin, ['--list-models'], { timeoutMs: 10_000 });
    if (res.exitCode !== 0) {
      const fallback = await run(bin, ['models'], { timeoutMs: 10_000 });
      return fallback.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    }
    return res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @typedef {Object} McpEntry
 * @property {string} name
 * @property {string} status
 * @property {boolean} loaded
 */

/**
 * @returns {Promise<McpEntry[]>}
 */
export async function listConfiguredMcps() {
  try {
    const bin = await resolveBin();
    const res = await run(bin, ['mcp', 'list'], { timeoutMs: 5_000 });
    if (res.exitCode !== 0) return [];
    // Strip ANSI control sequences — cursor-agent writes them even under `run`.
    // eslint-disable-next-line no-control-regex
    const text = res.stdout.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    /** @type {McpEntry[]} */
    const out = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('Loading')) continue;
      const match = line.match(/^([^:\s]+):\s*(.+)$/);
      if (!match) continue;
      const name = match[1];
      const status = match[2].trim();
      const lower = status.toLowerCase();
      const loaded = lower.startsWith('loaded') || lower === 'ok' || lower.includes('approved');
      out.push({ name, status, loaded });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * @typedef {Object} SessionSummary
 * @property {string} id
 * @property {string=} summary
 * @property {string=} updatedAt
 */

/**
 * @param {string} [cwd]
 * @returns {Promise<SessionSummary[]>}
 */
export async function listSessions(cwd = process.cwd()) {
  try {
    const bin = await resolveBin();
    const res = await run(bin, ['ls', '--output-format', 'json'], {
      cwd,
      timeoutMs: 5_000,
    });
    if (res.exitCode !== 0 || !res.stdout) return [];
    let parsed;
    try {
      parsed = JSON.parse(res.stdout);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    /** @type {SessionSummary[]} */
    const out = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const id =
        (typeof row.id === 'string' && row.id) ||
        (typeof row.chat_id === 'string' && row.chat_id) ||
        (typeof row.chatId === 'string' && row.chatId);
      if (!id) continue;
      const summary =
        typeof row.summary === 'string'
          ? row.summary
          : typeof row.title === 'string'
            ? row.title
            : undefined;
      const updatedAt =
        typeof row.updated_at === 'string'
          ? row.updated_at
          : typeof row.updatedAt === 'string'
            ? row.updatedAt
            : undefined;
      /** @type {SessionSummary} */
      const entry = { id };
      if (summary !== undefined) entry.summary = summary;
      if (updatedAt !== undefined) entry.updatedAt = updatedAt;
      out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}
