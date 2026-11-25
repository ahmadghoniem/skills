import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './shared/proc.mjs';
import { parseVersion } from './shared/release.mjs';

/**
 * What the message says; the brief itself rides along as an attached file,
 * which opencode reads in full.
 */
export const SIDECAR_MESSAGE =
  'Carry out the task in the attached file exactly as written. Where it is silent, follow the closest ' +
  'existing pattern in the repository. Finish by reporting what you changed and anything you could not do.';

/** @type {string|null} */
let cachedBin = null;

export function resetBinCache() {
  cachedBin = null;
}

/** `OPENCODE_BIN`, then PATH. */
export async function resolveBin() {
  if (cachedBin) return cachedBin;
  const override = process.env.OPENCODE_BIN?.trim();
  if (override) return (cachedBin = override);
  const res = await run('where', ['opencode'], { timeoutMs: 5_000 });
  const hit = res.stdout.split(/\r?\n/).find((l) => l.trim());
  if (res.exitCode === 0 && hit) return (cachedBin = hit.trim());
  throw new Error('opencode not found on PATH. Install it (`bun add -g @opencode/cli`), or set OPENCODE_BIN to its full path.');
}

/** The installed opencode version, or null. */
export async function installedVersion() {
  try {
    const res = await run(await resolveBin(), ['--version'], { timeoutMs: 15_000 });
    return res.exitCode === 0 ? parseVersion(res.stdout + res.stderr) : null;
  } catch {
    return null;
  }
}

/**
 * A new session id. opencode refuses ids that do not start with `ses`, and
 * creates the session when `--session` names one that does not exist yet, so a
 * run that dies still leaves a session to continue.
 */
export const newSessionId = () => `ses_${randomBytes(13).toString('hex')}`;

/**
 * opencode's argv for one headless run.
 *
 * - `--model` is required: with none, opencode picks one of its configured
 *   models on its own, which may be metered.
 * - `--dangerously-skip-permissions` approves every permission not explicitly
 *   denied; nobody can answer a prompt in a headless run. It is hidden from
 *   `--help` and is an alias of `--auto` (as is `--yolo`); the name matches agy's.
 * - `-f` attaches the brief. It is an array flag that swallows the tokens after
 *   it, so `--` must come before the message.
 * - `--continue` is never used: it takes the newest session, which may belong to
 *   another Claude session.
 * - `--standalone` runs the turn in a private server under this process. Without
 *   it the turn runs in opencode's background service (`opencode serve
 *   --service`), so stopping the run (TaskStop) leaves the turn and its shell
 *   commands running there. Sessions are shared either way.
 *
 * @param {{model: string, sessionId: string, promptFile: string}} o
 */
export function buildArgs(o) {
  return ['run', '--standalone', '--format', 'json', '--dangerously-skip-permissions', '--model', o.model, '--session', o.sessionId, '-f', o.promptFile, '--', SIDECAR_MESSAGE];
}

/**
 * Tools a headless delegate has no use for, denied for the run only (your own
 * opencode keeps them): `question` asks a user nobody is there to be, the
 * generators make media, and `execute` is Code Mode, whose catalog carries the
 * scheduler (`automation_*`) and opencode's own session, worktree and MCP tools
 * (`opencode_*`). Denying `execute` alone turns that catalog into plain tools,
 * so the two patterns go too. Checked on 2.4.1 against the request opencode
 * sends: 46 KB of prompt and tools fall to 27 KB. `opencode_worktree_remove`
 * survives every permission rule and the `tools` key.
 */
export const DELEGATE_CONFIG = Object.freeze({
  permission: { question: 'deny', generate_image: 'deny', generate_video: 'deny', execute: 'deny', 'automation_*': 'deny', 'opencode_*': 'deny' },
});

/**
 * The environment opencode runs with:
 * - no `CLAUDECODE`, so a `claude` command it runs is not refused as nested;
 * - `DELEGATE_CONFIG`, merged over your config for this run only (`--standalone` keeps it in this process);
 * - Claude Code compatibility off, so `~/.claude` skills and instructions written for Claude stay out; the brief carries what the run needs.
 */
export function childEnv(base = process.env) {
  const env = { ...base };
  delete env.CLAUDECODE;
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify(DELEGATE_CONFIG);
  env.OPENCODE_DISABLE_CLAUDE_CODE = '1';
  return env;
}

/**
 * Read `--format json` output: one event per line, `{type, sessionID, part|error}`.
 * The write-up is the text parts in order; `error` events say why a run failed;
 * a tool part whose state is `error` could not run at all (a command that exits
 * non-zero still reports `completed`).
 *
 * @param {string} stdout
 */
export function parseStream(stdout) {
  const texts = [];
  const errors = [];
  const toolErrors = [];
  let sessionId;
  for (const line of stdout.split(/\r?\n/)) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (!ev || typeof ev !== 'object') continue;
    if (typeof ev.sessionID === 'string' && ev.sessionID) sessionId = ev.sessionID;
    const part = ev.part ?? {};
    if (ev.type === 'text' && typeof part.text === 'string') texts.push(part.text);
    if (ev.type === 'error') {
      const e = ev.error ?? {};
      errors.push([e.type, e.message ?? e.data?.message].filter(Boolean).join(': ') || JSON.stringify(e));
    }
    if (part.type === 'tool' && part.state?.status === 'error') {
      toolErrors.push({ tool: String(part.tool ?? 'tool'), message: String(part.state.error ?? 'failed') });
    }
  }
  return { text: texts.join('\n\n'), error: errors.join('\n') || undefined, toolErrors, sessionId };
}

/**
 * Run opencode once and wait for it. An inline brief goes through a temp file.
 *
 * @param {{prompt?: string, promptFile?: string, model: string, session?: string, cwd?: string}} o
 */
export async function runHeadless(o) {
  const bin = await resolveBin();
  const tempFile = o.promptFile ? null : join(tmpdir(), `opencode-brief-${randomBytes(6).toString('hex')}.md`);
  if (tempFile) writeFileSync(tempFile, o.prompt ?? '', 'utf8');
  const sessionId = o.session ?? newSessionId();
  try {
    const res = await run(bin, buildArgs({ model: o.model, sessionId, promptFile: o.promptFile ?? tempFile }), {
      cwd: o.cwd ?? process.cwd(),
      env: childEnv(),
    });
    const parsed = parseStream(res.stdout);
    let error = parsed.error;
    if (!error && res.exitCode !== 0) {
      error = res.stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-5).join('\n') || undefined;
    }
    return { exitCode: res.exitCode, text: parsed.text, error, toolErrors: parsed.toolErrors, sessionId: parsed.sessionId ?? sessionId };
  } finally {
    if (tempFile) rmSync(tempFile, { force: true });
  }
}
