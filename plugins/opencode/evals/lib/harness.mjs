// Shared plumbing for the opencode plugin evals: throwaway repositories with a
// private COD_HOME, headless Claude Code sessions, bounded concurrency, and a
// results directory written case by case.
//
// There is no stub. Every case runs the real `opencode` binary against a real
// provider, because a stub can only ever confirm what its author already
// believed about the CLI. The cost of that choice is non-determinism, which is
// what the rep count is for, and real money, which is small.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN = fileURLToPath(new URL('../../', import.meta.url));
export const SCRIPTS = join(PLUGIN, 'scripts');
export const RESULTS_ROOT = fileURLToPath(new URL('../results/', import.meta.url));

/** Live by default is wrong for an eval that spends money; opt in. */
export const LIVE = process.env.OPENCODE_EVAL_LIVE === '1';

// The npm shim is a .cmd, which cannot be spawned without a shell; use the exe.
export const CLAUDE_BIN =
  process.env.CLAUDE_BIN ||
  join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');

/** The model every case that is meant to succeed runs on. */
export const MODEL = process.env.OPENCODE_EVAL_MODEL || 'nebius/deepseek-ai/DeepSeek-V4.1-Flash';

/**
 * A model on a provider with no usable credentials, for the provider-error
 * case. Allowed in the case's config so the gate lets it through; the failure
 * then happens where it is supposed to, at the provider.
 */
export const DEAD_MODEL = process.env.OPENCODE_EVAL_DEAD_MODEL || 'featherless/zai-org/GLM-5.2';

/** A real model that is deliberately left off the allowlist. */
export const UNALLOWED_MODEL = 'baseten/moonshotai/Kimi-K3';

/** A git repository with one commit, and a private COD_HOME beside it. */
export function makeRepo(files = { 'README.md': '# eval repo\n' }) {
  const dir = mkdtempSync(join(tmpdir(), 'cod-eval-'));
  const repo = join(dir, 'repo');
  const codHome = join(dir, 'cod');
  mkdirSync(repo);
  mkdirSync(codHome);
  for (const [name, body] of Object.entries(files)) {
    const full = join(repo, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body, 'utf8');
  }
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'eval@example.com');
  git('config', 'user.name', 'eval');
  git('config', 'core.autocrlf', 'false');
  git('add', '-A');
  git('commit', '-qm', 'base');
  return {
    dir,
    repo,
    codHome,
    git,
    /** Files changed since the base commit. */
    changed: () =>
      git('diff', '--name-only', 'HEAD')
        .stdout.split(/\r?\n/)
        .filter(Boolean),
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
  };
}

/**
 * Preset the allowlist a case starts from. `models: []` is the empty-allowlist
 * state that must block every dispatch.
 *
 * @param {string} codHome
 * @param {string[]} models
 */
export function seedAllowlist(codHome, models) {
  writeFileSync(
    join(codHome, 'config.json'),
    `${JSON.stringify({ models, default: models[0] ?? null }, null, 2)}\n`,
    'utf8',
  );
}

/** Read the allowlist back, to see whether the session edited it. */
export function readAllowlist(codHome) {
  try {
    return JSON.parse(readFileSync(join(codHome, 'config.json'), 'utf8'));
  } catch {
    return { models: [], default: null };
  }
}

export function jobFiles(codHome) {
  const root = join(codHome, 'jobs');
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((d) => readdirSync(join(root, d)).map((f) => join(root, d, f)));
}

/**
 * Run a headless Claude Code session over one or more user turns.
 *
 * A plain `claude -p` can exit before a background task notifies, so the
 * session runs in stream-json input mode and stdin stays open until every
 * background task it started has notified and the turn after that has
 * finished. Extra turns are sent as each preceding turn settles, which is what
 * lets a case test a follow-up ("carry on and finish it") against real state.
 *
 * @param {string[]} turns
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @param {number} timeoutMs
 */
/**
 * The model the sessions under test run on. Pinned rather than inherited: an
 * unpinned `claude -p` takes the default, so the same suite silently measures a
 * different caller from one month to the next, and a 57-session run on the
 * expensive default is what exhausted the account limit mid-run on 2026-09-19.
 */
export const CALLER_MODEL = process.env.OPENCODE_EVAL_CALLER_MODEL ?? 'sonnet';

// Two model knobs an arm's length apart, one for each end of the delegation.
// Crossing them costs a whole run and says nothing useful on the way down: the
// caller is handed a provider id it cannot resolve, or opencode is handed a
// Claude alias and every job fails at dispatch. An opencode id is always
// provider-qualified and a Claude alias never is, so the mix-up is cheap to
// catch here and expensive to find in the results.
if (!MODEL.includes('/')) {
  throw new Error(
    `OPENCODE_EVAL_MODEL must be a provider-qualified opencode model id, got "${MODEL}". ` +
      'The Claude model the sessions run on is OPENCODE_EVAL_CALLER_MODEL.',
  );
}
if (CALLER_MODEL.includes('/')) {
  throw new Error(
    `OPENCODE_EVAL_CALLER_MODEL must be a Claude model alias or id, got "${CALLER_MODEL}". ` +
      'The opencode model is OPENCODE_EVAL_MODEL.',
  );
}

export function runClaude(turns, cwd, env, timeoutMs = 25 * 60_000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      CLAUDE_BIN,
      [
        '-p',
        '--model', CALLER_MODEL,
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--dangerously-skip-permissions',
        '--no-session-persistence',
      ],
      { cwd, env: { ...process.env, ...env }, windowsHide: true },
    );

    const send = (text) =>
      child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`);

    let turnIndex = 0;
    send(turns[turnIndex++]);

    let stdout = '';
    let stderr = '';
    let buf = '';
    let tasksStarted = 0;
    let tasksNotified = 0;
    let closedInput = false;

    child.stdout.on('data', (d) => {
      stdout += d;
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        if (e.type === 'system' && e.subtype === 'task_started') tasksStarted++;
        if (e.type === 'system' && e.subtype === 'task_notification') tasksNotified++;
        if (e.type === 'result' && tasksNotified >= tasksStarted) {
          if (turnIndex < turns.length) send(turns[turnIndex++]);
          else if (!closedInput) {
            closedInput = true;
            child.stdin.end();
          }
        }
      }
    });
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, ms: Date.now() - started });
    });
  });
}

/**
 * Fold a stream-json transcript into the shapes the checks need: every tool
 * call with the index it happened at and how many background tasks were live
 * at the time, every tool result, the per-turn `result` events, and the final
 * status of each backgrounded call.
 *
 * @param {string} text
 */
export function parseStream(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // A torn line at the end of a killed session.
    }
  }
  const toolUses = [];
  const toolResults = new Map();
  const results = [];
  const taskStatus = new Map();
  let running = 0;
  for (const [i, e] of events.entries()) {
    if (e.type === 'system' && e.subtype === 'task_started') running++;
    if (e.type === 'system' && e.subtype === 'task_notification') {
      running = Math.max(0, running - 1);
      if (e.tool_use_id) taskStatus.set(e.tool_use_id, e.status);
    }
    if (e.type === 'assistant') {
      for (const b of e.message?.content ?? []) if (b.type === 'tool_use') toolUses.push({ ...b, index: i, running });
    }
    if (e.type === 'user' && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) if (b.type === 'tool_result') toolResults.set(b.tool_use_id, b);
    }
    if (e.type === 'result') results.push(e);
  }
  // A session the CLI itself cut short — a usage limit, an API error — still
  // emits a result event, so counting results is not enough to tell a graded
  // session from a halted one. Such a run is not a model failure and must not
  // be scored as one.
  const halted = results.find(
    (r) => r.is_error === true || HALT_TEXT.test(String(r.result ?? '')),
  );
  return {
    events,
    toolUses,
    toolResults,
    results,
    taskStatus,
    halted: halted ? String(halted.result ?? halted.subtype ?? 'error') : null,
  };
}

const HALT_TEXT =
  /hit your (session|usage) limit|usage limit reached|resets \d+(am|pm)|Credit balance is too low|Overloaded/i;

export const cmdOf = (t) => String(t.input?.command ?? '');

export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 95% Wilson interval for k passes out of n. */
export function wilson(k, n) {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * One results directory per run. Rows are appended as cases finish, so a crash
 * keeps what already ran. Attempts that never produced a gradeable session go
 * to `errors.jsonl` instead, where they cannot be mistaken for a model failure.
 */
export function openResults(evalName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(RESULTS_ROOT, evalName, stamp);
  mkdirSync(dir, { recursive: true });
  const rowsPath = join(dir, 'results.jsonl');
  const errPath = join(dir, 'errors.jsonl');
  return {
    dir,
    stamp,
    row(obj) {
      appendFileSync(rowsPath, `${JSON.stringify(obj)}\n`, 'utf8');
    },
    error(obj) {
      appendFileSync(errPath, `${JSON.stringify(obj)}\n`, 'utf8');
    },
    /**
     * checks: [{ id, title, guardrail, results: [{ case, rep, pass, detail }] }]
     */
    summarise(checks, extra = {}) {
      const lines = [`# ${evalName}`, '', `Run ${stamp}`, ''];
      if (extra.preamble) lines.push(extra.preamble, '');
      lines.push('| Check | Passed | Rate | 95% CI | Aggregation |', '| --- | --- | --- | --- | --- |');
      const summary = [];
      const pct = (x) => `${Math.round(x * 100)}%`;
      for (const c of checks) {
        const n = c.results.length;
        const k = c.results.filter((r) => r.pass).length;
        const [lo, hi] = wilson(k, n);
        summary.push({
          id: c.id,
          title: c.title,
          guardrail: Boolean(c.guardrail),
          passed: k,
          total: n,
          rate: n ? k / n : null,
          ci: [lo, hi],
        });
        // A guardrail is reported fail-on-any: one bypass in thirty runs is a
        // finding, and a mean over easy reps would bury it.
        const agg = c.guardrail ? (k === n ? 'clean' : `${n - k} BREACH`) : 'mean';
        lines.push(`| ${c.title} | ${k}/${n} | ${n ? pct(k / n) : 'n/a'} | ${n ? `${pct(lo)}–${pct(hi)}` : ''} | ${agg} |`);
      }
      for (const c of checks) {
        const failed = c.results.filter((r) => !r.pass);
        if (failed.length === 0) continue;
        lines.push('', `## Failed: ${c.title}`, '');
        for (const r of failed.slice(0, 12)) lines.push(`- \`${r.case}\` rep ${r.rep}: ${r.detail ?? ''}`);
        if (failed.length > 12) lines.push(`- … ${failed.length - 12} more in results.jsonl`);
      }
      if (extra.appendix) lines.push('', extra.appendix);
      writeFileSync(join(dir, 'summary.json'), JSON.stringify({ eval: evalName, stamp, checks: summary, ...extra.data }, null, 2), 'utf8');
      writeFileSync(join(dir, 'summary.md'), `${lines.join('\n')}\n`, 'utf8');
      return { dir, summary };
    },
  };
}
