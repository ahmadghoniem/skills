import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { codexHome } from './paths.mjs';
import { run, spawnDirect } from '../../../../scripts/lib/shared/proc.mjs';
import { parseVersion } from '../../../../scripts/lib/shared/release.mjs';

/** @type {string|null} */
let cachedBin = null;

export function resetBinCache() {
  cachedBin = null;
}

/**
 * `CODEX_BIN`, then the standalone installer's `codex.exe`, then PATH. The
 * standalone binary is started directly; npm's `codex.cmd` wrapper would need a
 * shell, which mangles quotes, `%` and long text.
 */
export async function resolveBin() {
  if (cachedBin) return cachedBin;
  const override = process.env.CODEX_BIN?.trim();
  if (override) return (cachedBin = override);
  const standalone = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
  if (existsSync(standalone)) return (cachedBin = standalone);
  const res = await run('where', ['codex.exe'], { timeoutMs: 5_000 });
  const hit = res.stdout.split(/\r?\n/).find((l) => l.trim());
  if (res.exitCode === 0 && hit) return (cachedBin = hit.trim());
  throw new Error(`codex not found at ${standalone} or on PATH. Install the standalone Codex CLI, or set CODEX_BIN to its full path.`);
}

/** The installed codex version, or null. */
export async function installedVersion() {
  try {
    const res = await run(await resolveBin(), ['--version'], { timeoutMs: 10_000 });
    return res.exitCode === 0 ? parseVersion(res.stdout + res.stderr) : null;
  } catch {
    return null;
  }
}

/**
 * The models Codex offers this account, from the list it keeps in
 * `~/.codex/models_cache.json`: each one's effort levels and its default.
 * Reading it costs nothing, so it is read on every run.
 *
 * @returns {Promise<{id: string, efforts: string[], defaultEffort?: string}[]>}
 */
export async function listModels() {
  const doc = JSON.parse(readFileSync(join(codexHome(), 'models_cache.json'), 'utf8'));
  return (doc.models ?? [])
    .filter((m) => typeof m?.slug === 'string' && m.visibility !== 'hide')
    .map((m) => ({
      id: m.slug,
      efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort).filter(Boolean),
      defaultEffort: m.default_reasoning_level ?? undefined,
    }));
}

/**
 * codex's argv for one run.
 *
 * - `exec --json`: one JSON event per line; `thread.started` names the session first.
 * - `--dangerously-bypass-approvals-and-sandbox`: nobody can answer an approval,
 *   as with the other CLIs; the guard is that nothing is committed and Claude reads the diff.
 * - `--skip-git-repo-check`: codex refuses to start outside a git repository
 *   without it (council and scratch folders aren't). `--trust` is not passed: it
 *   writes the folder into `config.toml` for good, and with approvals and the
 *   sandbox bypassed it changes nothing else a run needs.
 * - The prompt goes on stdin (`-`), which is then closed: with the prompt as an
 *   argument codex waits on an open stdin (openai/codex#20919).
 * - Your `config.toml` is read as usual (MCP servers, plugins, skills); `-m` and
 *   the effort override its model settings.
 *
 * @param {{model?: string, effort?: string, sessionId?: string}} o
 * @returns {string[]}
 */
export function buildArgs(o) {
  const args = ['exec'];
  if (o.sessionId) args.push('resume', o.sessionId);
  args.push('--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check');
  if (o.model) args.push('-m', o.model);
  if (o.effort) args.push('-c', `model_reasoning_effort=${o.effort}`);
  args.push('-');
  return args;
}

/** The environment codex runs with: no `CLAUDECODE`, so a `claude` command it runs is not refused as nested. */
export function childEnv(base = process.env) {
  const env = { ...base };
  delete env.CLAUDECODE;
  return env;
}

/**
 * Fold `exec --json` events into a run. The write-up is the agent messages in
 * order; `error` events and a failed turn say why a run stopped; an `error`
 * item is a note codex printed and kept going after.
 *
 * @param {Record<string, any>[]} events
 */
export function summarise(events) {
  const texts = [];
  const errors = [];
  const notes = [];
  let sessionId;
  let usage;
  for (const ev of events) {
    if (ev.type === 'thread.started' && typeof ev.thread_id === 'string') sessionId = ev.thread_id;
    if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && typeof ev.item.text === 'string') texts.push(ev.item.text);
    if (ev.type === 'item.completed' && ev.item?.type === 'error' && ev.item.message) notes.push(String(ev.item.message));
    if (ev.type === 'error' && ev.message) errors.push(String(ev.message));
    if (ev.type === 'turn.failed' && ev.error?.message && !errors.includes(ev.error.message)) errors.push(String(ev.error.message));
    if (ev.type === 'turn.completed') usage = ev.usage;
  }
  return { text: texts.join('\n\n'), error: errors.join('\n') || undefined, notes, sessionId, usage };
}

/**
 * Run codex once and wait for it, reporting the session id as soon as
 * `thread.started` names it.
 *
 * @param {{prompt: string, model?: string, effort?: string, sessionId?: string, cwd?: string, onSession?: (id: string) => void}} o
 */
export async function runHeadless(o) {
  const bin = await resolveBin();
  const child = spawnDirect(bin, buildArgs(o), { cwd: o.cwd ?? process.cwd(), env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  child.stdin.end(o.prompt, 'utf8');
  const events = [];
  const stderr = [];
  const out = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const err = createInterface({ input: child.stderr, crlfDelay: Infinity });
  const drained = Promise.all([once(out, 'close'), once(err, 'close')]);
  out.on('line', (line) => {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    if (!ev || typeof ev !== 'object') return;
    events.push(ev);
    if (ev.type === 'thread.started' && typeof ev.thread_id === 'string') o.onSession?.(ev.thread_id);
  });
  err.on('line', (line) => {
    if (!line.trim()) return;
    stderr.push(line);
    if (stderr.length > 20) stderr.shift();
  });
  const exitCode = await new Promise((resolve) => {
    child.on('error', (e) => {
      stderr.push(`spawn failed: ${e.message}`);
      resolve(127);
    });
    child.on('close', (code) => resolve(typeof code === 'number' ? code : 1));
  });
  await drained;
  const s = summarise(events);
  let error = s.error;
  if (!error && exitCode !== 0) error = stderr.slice(-5).join('\n') || undefined;
  return { exitCode, text: s.text, error, notes: s.notes, sessionId: s.sessionId ?? o.sessionId, usage: s.usage };
}
