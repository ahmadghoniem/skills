// Shared plumbing for the agy evals: throwaway repositories, running the
// plugin's scripts as real child processes, bounded concurrency, and a results
// directory that is written case by case.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN = fileURLToPath(new URL('../../', import.meta.url));
export const SCRIPTS = join(PLUGIN, 'scripts');
export const REPLAY_STUB = fileURLToPath(new URL('./replay-stub.mjs', import.meta.url));
export const REPLAY_DIR = fileURLToPath(new URL('../fixtures/replay/', import.meta.url));
export const RESULTS_ROOT = fileURLToPath(new URL('../results/', import.meta.url));

export const LIVE = process.env.AGY_EVAL_LIVE === '1';

/** A git repository with one commit, and a private CAD_HOME beside it. */
export function makeRepo(files = { 'README.md': '# eval repo\n' }) {
  const dir = mkdtempSync(join(tmpdir(), 'agy-eval-'));
  const repo = join(dir, 'repo');
  const cadHome = join(dir, 'cad');
  mkdirSync(repo);
  mkdirSync(cadHome);
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
    cadHome,
    git,
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
  };
}

/**
 * Run a plugin script the way the slash commands do and capture everything.
 * Resolves with `pid` available immediately through `onSpawn`.
 */
export function runScript(script, argv, { cwd, env = {}, timeoutMs = 120_000, onSpawn } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(SCRIPTS, script), '--', ...argv], {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    if (onSpawn) onSpawn(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, ms: Date.now() - started });
    });
  });
}

export function readJobs(cadHome) {
  const root = join(cadHome, 'jobs');
  if (!existsSync(root)) return [];
  const out = [];
  for (const d of readdirSync(root)) {
    for (const f of readdirSync(join(root, d))) {
      if (!f.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(readFileSync(join(root, d, f), 'utf8')));
      } catch {
        // half-written record
      }
    }
  }
  return out;
}

export function loadReplayFixtures() {
  if (!existsSync(REPLAY_DIR)) {
    throw new Error('No replay fixtures. They are not committed; build them first: node evals/build-fixtures.mjs');
  }
  return readdirSync(REPLAY_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ name: f.slice(0, -5), path: join(REPLAY_DIR, f), ...JSON.parse(readFileSync(join(REPLAY_DIR, f), 'utf8')) }));
}

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

/** Lines the renderer marks as warnings. */
export const warnLines = (text) => text.split(/\r?\n/).filter((l) => l.startsWith('⚠'));

/**
 * One results directory per run. Rows are appended as cases finish, so a crash
 * keeps what already ran.
 */
export function openResults(evalName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(RESULTS_ROOT, evalName, stamp);
  mkdirSync(dir, { recursive: true });
  const rowsPath = join(dir, 'results.jsonl');
  return {
    dir,
    row(obj) {
      appendFileSync(rowsPath, JSON.stringify(obj) + '\n', 'utf8');
    },
    /**
     * checks: [{ id, title, flaw, results: [{ case, pass, detail }] }]
     */
    summarise(checks, extra = {}) {
      const lines = [`# ${evalName}`, '', `Run ${stamp}`, ''];
      if (extra.preamble) lines.push(extra.preamble, '');
      lines.push('| Check | Passed | Rate | 95% CI | Ledger |', '| --- | --- | --- | --- | --- |');
      const summary = [];
      for (const c of checks) {
        const n = c.results.length;
        const k = c.results.filter((r) => r.pass).length;
        const [lo, hi] = wilson(k, n);
        summary.push({ id: c.id, title: c.title, flaw: c.flaw ?? null, passed: k, total: n, rate: n ? k / n : null, ci: [lo, hi] });
        const pct = (x) => `${Math.round(x * 100)}%`;
        lines.push(`| ${c.title} | ${k}/${n} | ${n ? pct(k / n) : 'n/a'} | ${n ? `${pct(lo)}–${pct(hi)}` : ''} | ${c.flaw ?? ''} |`);
      }
      for (const c of checks) {
        const failed = c.results.filter((r) => !r.pass);
        if (failed.length === 0) continue;
        lines.push('', `## Failed: ${c.title}`, '');
        for (const r of failed.slice(0, 12)) lines.push(`- \`${r.case}\` ${r.detail ?? ''}`);
        if (failed.length > 12) lines.push(`- … ${failed.length - 12} more in results.jsonl`);
      }
      if (extra.appendix) lines.push('', extra.appendix);
      writeFileSync(join(dir, 'summary.json'), JSON.stringify({ eval: evalName, stamp, checks: summary, ...extra.data }, null, 2), 'utf8');
      writeFileSync(join(dir, 'summary.md'), lines.join('\n') + '\n', 'utf8');
      return { dir, summary };
    },
  };
}
