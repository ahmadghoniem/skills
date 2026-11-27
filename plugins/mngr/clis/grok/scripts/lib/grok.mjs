import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseVersion } from '../../../../scripts/lib/shared/release.mjs';
import { run, spawnDirect } from '../../../../scripts/lib/shared/proc.mjs';

/** The xAI plan this runs on allows only `low` and `medium`. */
export const EFFORTS = Object.freeze(['low', 'medium']);
export const DEFAULT_EFFORT = 'medium';

/**
 * Set on every run, so the user's Claude Code and Cursor agents, hooks, MCP
 * servers, rules and skills stay out of a delegated run: the brief carries what
 * grok needs. Three sources have no per-run switch and still load: Claude Code
 * plugins (`[plugins]` in `~/.grok/config.toml`), skills in `~/.agents/skills`
 * (`[skills] ignore`), and the permission rules in `~/.claude/settings.json`.
 */
export const COMPAT_OFF_ENV = Object.freeze(
  Object.fromEntries(
    ['CLAUDE', 'CURSOR'].flatMap((vendor) =>
      ['AGENTS', 'HOOKS', 'MCPS', 'RULES', 'SKILLS'].map((kind) => [`GROK_${vendor}_${kind}_ENABLED`, 'false']),
    ),
  ),
);

/**
 * Removed from grok's environment. `CLAUDECODE` is set in every Claude Code
 * session; grok does not read it, but a `claude` command grok runs would take
 * itself for a nested session and refuse to start. The `GROK_*` overrides would
 * swap grok's agent or config, or switch folder trust off, under the flags below.
 */
export const REMOVED_ENV = Object.freeze(['CLAUDECODE', 'GROK_AGENT', 'GROK_CONFIG', 'GROK_CONFIG_PATH', 'GROK_FOLDER_TRUST']);

/**
 * Built-in tools a headless run can't use: media generation nobody asked for,
 * questions and plan approval nobody can answer, feedback to xAI, and scheduled
 * jobs that would outlive the run.
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
  'workflow',
]);

/** @type {string|null} */
let cachedBin = null;

/**
 * `GROK_BIN`, then PATH, then the installer's folder. The installer adds its
 * folder to the persistent PATH, which a session started earlier has not picked up.
 *
 * @returns {Promise<string>}
 */
export async function resolveBin() {
  if (cachedBin) return cachedBin;
  const override = process.env.GROK_BIN?.trim();
  if (override) return (cachedBin = override);
  const res = await run('where', ['grok'], { timeoutMs: 5_000 });
  const hit = res.stdout.split(/\r?\n/).find((l) => l.trim());
  if (res.exitCode === 0 && hit) return (cachedBin = hit.trim());
  const installed = join(homedir(), '.grok', 'bin', 'grok.exe');
  if (existsSync(installed)) return (cachedBin = installed);
  throw new Error('grok not found on PATH or at %USERPROFILE%\\.grok\\bin. Install the Grok CLI, or set GROK_BIN to its full path.');
}

/**
 * The models grok offers this account, from the list it keeps in
 * `~/.grok/models_cache.json` (`GROK_HOME` moves `~/.grok`). Reading it costs
 * nothing, so it is read on every run.
 *
 * @returns {Promise<{id: string}[]>}
 */
export async function listModels() {
  const file = join(process.env.GROK_HOME?.trim() || join(homedir(), '.grok'), 'models_cache.json');
  const models = JSON.parse(readFileSync(file, 'utf8')).models ?? [];
  return models.map((m) => m?.info?.id).filter((id) => typeof id === 'string').map((id) => ({ id }));
}

/** The installed grok version, or null. */
export async function installedVersion() {
  try {
    const res = await run(await resolveBin(), ['--version'], { timeoutMs: 5_000 });
    return res.exitCode === 0 ? parseVersion(res.stdout + res.stderr) : null;
  } catch {
    return null;
  }
}

/**
 * grok's argv for one headless run.
 *
 * - `--output-format json`: one object at the end with the text, stop reason,
 *   session id and spend, or `{type: "error", message}`.
 * - `--always-approve`: nobody can answer an approval prompt. The guard is that
 *   nothing is committed and Claude reads the diff.
 * - `--trust` and `--no-auto-update` are hidden flags (missing from `--help`,
 *   documented in the bundled user guide). `--trust` loads the repo's
 *   `AGENTS.md`, `CLAUDE.md` and `.grok/` config.
 * - `-s <uuid>` names a new session before it starts, so a run that dies still
 *   leaves a session to resume. A resume passes `--resume <uuid>` instead.
 *   `--continue` is never used: it picks the directory's newest session, which
 *   may belong to another Claude session.
 * - `--sandbox` is never passed: grok has no sandbox enforcement on Windows.
 *
 * @param {{promptFile: string, model?: string, effort?: string, sessionId?: string, resume?: boolean}} o
 * @returns {string[]}
 */
export function buildArgs(o) {
  const args = [
    '--prompt-file', o.promptFile,
    '--output-format', 'json',
    '--always-approve', '--trust', '--no-auto-update', '--no-plan',
    '--disallowed-tools', DISALLOWED_TOOLS.join(','),
  ];
  if (o.model) args.push('-m', o.model);
  if (o.effort) args.push('--reasoning-effort', o.effort);
  if (o.sessionId) args.push(o.resume ? '--resume' : '-s', o.sessionId);
  return args;
}

/** The environment grok runs with. */
export function childEnv(base = process.env) {
  const env = { ...base, ...COMPAT_OFF_ENV };
  for (const name of REMOVED_ENV) delete env[name];
  return env;
}

/**
 * grok's closing JSON object, or null. It is normally the whole of stdout; a
 * line-by-line fallback covers anything printed before it.
 *
 * @param {string} stdout
 * @returns {Record<string, unknown>|null}
 */
export function parseResult(stdout) {
  const tryParse = (s) => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  const whole = tryParse(stdout.trim());
  if (whole) return whole;
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const v = tryParse(lines[i]);
    if (v) return v;
  }
  return null;
}

/**
 * grok's error text, with a provider message that grok wrapped in JSON
 * (`API error (status 402 …): {"message": …}`) brought onto the first line.
 *
 * @param {string} message
 */
export function readableError(message) {
  const start = message.indexOf('{');
  if (start < 0) return message;
  try {
    const inner = JSON.parse(message.slice(start));
    if (typeof inner?.message === 'string' && inner.message.trim()) {
      return `${message.slice(0, start).trim()} ${inner.message.trim()}`.trim();
    }
  } catch {
    // not JSON after all
  }
  return message;
}

/**
 * @typedef {Object} RunResult
 * @property {number} exitCode
 * @property {string} sessionId
 * @property {string} text
 * @property {string=} stopReason
 * @property {string=} error
 * @property {number=} turns
 */

/**
 * Run grok once and wait for it. The brief goes through a temp file, so no
 * brief ever reaches the command line.
 *
 * @param {{prompt: string, model?: string, effort?: string, sessionId?: string, resume?: boolean, cwd?: string}} o
 * @returns {Promise<RunResult>}
 */
export async function runHeadless(o) {
  const bin = await resolveBin();
  const tempFile = join(tmpdir(), `grok-brief-${randomUUID()}.md`);
  writeFileSync(tempFile, o.prompt, 'utf8');
  const sessionId = o.sessionId ?? randomUUID();
  const args = buildArgs({ promptFile: tempFile, model: o.model, effort: o.effort, sessionId, resume: Boolean(o.resume) });
  try {
    const res = await run(bin, args, { cwd: o.cwd ?? process.cwd(), env: childEnv() });
    const out = parseResult(res.stdout) ?? {};
    const stderr = res.stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let error = out.type === 'error' || out.error ? String(out.message ?? out.error ?? '') : '';
    // No JSON at all (a crash, a refused flag): the end of stderr says why.
    if (!error && res.exitCode !== 0 && !out.text) error = stderr.slice(-5).join('\n');
    return {
      exitCode: res.exitCode,
      sessionId: typeof out.sessionId === 'string' ? out.sessionId : sessionId,
      text: typeof out.text === 'string' ? out.text : '',
      stopReason: typeof out.stopReason === 'string' ? out.stopReason : undefined,
      error: error ? readableError(error.trim()) : undefined,
      turns: typeof out.num_turns === 'number' ? out.num_turns : undefined,
    };
  } finally {
    rmSync(tempFile, { force: true });
  }
}
