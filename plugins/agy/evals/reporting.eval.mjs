// Eval 1: does the plugin tell the caller the truth about a run?
//
// Every recorded agy run (scrubbed into fixtures/replay) is replayed through the
// real delegate.mjs against a stub agy, inside a throwaway git repo. The grader
// compares what the caller receives (stdout, exit code, job record) with the
// fixture's `truth`, which build-fixtures.mjs derived from the raw run, never
// from the renderer. A handful of scripted scenarios cover what replay cannot:
// parallel jobs, orphaned records, id lookups across repositories, resume
// fallbacks, and argv for models that take no effort flag.
//
// Free and offline. Run: npm run eval -- reporting
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  REPLAY_DIR,
  REPLAY_STUB,
  loadReplayFixtures,
  makeRepo,
  openResults,
  pool,
  readJobs,
  runScript,
  warnLines,
} from './lib/harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CAUSE = {
  timeout: /time ?out/i,
  'stream-drop': /interrupt|network|retry/i,
  quota: /quota/i,
  'never-started': /invalid|not recognized|not supported|failed|eligibility/i,
  'spawn-failed': /spawn|not found/i,
  watchdog: /watchdog/i,
};

const checks = {
  visible: { id: 'visible', title: 'Unfinished run raises a warning', flaw: 'F1', results: [] },
  cause: { id: 'cause', title: 'Warning names the cause', flaw: 'F1, F15', results: [] },
  resume: { id: 'resume', title: 'Resumable run offers /agy:resume', flaw: 'F5', results: [] },
  exit: { id: 'exit', title: 'Unfinished run exits non-zero', flaw: 'F2', results: [] },
  neverStarted: { id: 'neverStarted', title: 'Never-started run recorded as failed', flaw: 'F7', results: [] },
  quiet: { id: 'quiet', title: 'Clean run is quiet: no warning, exit 0, done', flaw: 'F6', results: [] },
  conversation: { id: 'conversation', title: 'Conversation id saved', flaw: '', results: [] },
  parallel: { id: 'parallel', title: 'Parallel jobs count only their own files', flaw: 'F4', results: [] },
  effort: { id: 'effort', title: 'No --effort for a model that refuses it', flaw: 'F8', results: [] },
  orphan: { id: 'orphan', title: 'Dead wrapper does not leave a running record', flaw: 'F3', results: [] },
  bareCancel: { id: 'bareCancel', title: 'Bare cancel works with one live job and one orphan', flaw: 'F3', results: [] },
  crossRepo: { id: 'crossRepo', title: 'Job suffix does not match another repository', flaw: 'F11', results: [] },
  bareResume: { id: 'bareResume', title: 'Bare resume uses a saved conversation, not --continue', flaw: 'F13', results: [] },
  mentionsFile: { id: 'mentionsFile', title: 'Read-only run naming a file elsewhere stays quiet', flaw: 'F6', results: [] },
};

const results = openResults('reporting');

function grade(check, caseName, pass, detail = '') {
  checks[check].results.push({ case: caseName, pass, detail });
  results.row({ check, case: caseName, pass, detail });
}

async function replayCase(fx) {
  const env = makeRepo();
  try {
    const isWatchdog = fx.truth.class === 'watchdog';
    const argv = isWatchdog ? ['--timeout', '1', `eval case ${fx.name}`] : [`eval case ${fx.name}`];
    const run = await runScript('delegate.mjs', argv, {
      cwd: env.repo,
      env: {
        CAD_HOME: env.cadHome,
        AGY_BIN: REPLAY_STUB,
        AGY_REPLAY: fx.path,
        ...(isWatchdog ? { AGY_REPLAY_HANG: '1' } : {}),
      },
      timeoutMs: isWatchdog ? 110_000 : 60_000,
    });
    const record = readJobs(env.cadHome)[0] ?? null;
    return { fx, run, record };
  } finally {
    env.cleanup();
  }
}

function gradeReplay({ fx, run, record }) {
  const t = fx.truth;
  const warns = warnLines(run.stdout);
  const tag = `${fx.name} [${t.class}]`;
  const shown = (warns.join(' | ') || run.stdout.trim().split('\n').slice(-1)[0] || '').slice(0, 160);

  if (t.incomplete) {
    grade('visible', tag, warns.length > 0, `output: ${shown}`);
    const re = CAUSE[t.class];
    if (re) grade('cause', tag, re.test(run.stdout), `output: ${shown}`);
    grade('exit', tag, run.code !== 0, `exit ${run.code}`);
  }
  if (t.resumable) grade('resume', tag, /\/agy:resume/.test(run.stdout), `output: ${shown}`);
  if (t.class === 'never-started' || t.class === 'spawn-failed') {
    grade('neverStarted', tag, record?.status === 'failed', `record status ${record?.status}`);
  }
  if (t.class === 'clean') {
    const pass = warns.length === 0 && run.code === 0 && record?.status === 'done';
    grade('quiet', tag, pass, `warnings ${warns.length}, exit ${run.code}, status ${record?.status}`);
  }
  if (t.conversationId) {
    grade('conversation', tag, record?.conversationId === t.conversationId, `record ${record?.conversationId ?? 'none'}`);
  }
}

async function scenarioParallel() {
  const env = makeRepo();
  try {
    const fx = join(REPLAY_DIR, 'rec-000-clean.json');
    const base = { CAD_HOME: env.cadHome, AGY_BIN: REPLAY_STUB, AGY_REPLAY: fx, AGY_REPLAY_DELAY_MS: '2500' };
    await Promise.all([
      runScript('delegate.mjs', ['job a'], { cwd: env.repo, env: { ...base, AGY_REPLAY_WRITES: 'a1.txt,a2.txt' } }),
      runScript('delegate.mjs', ['job b'], { cwd: env.repo, env: { ...base, AGY_REPLAY_WRITES: 'b1.txt,b2.txt,b3.txt' } }),
    ]);
    const jobs = readJobs(env.cadHome);
    for (const [prompt, own] of [['job a', 2], ['job b', 3]]) {
      const j = jobs.find((x) => x.prompt === prompt);
      const n = j?.gitFiles?.length ?? null;
      grade('parallel', prompt, n === own, `wrote ${own}, record says ${n}`);
    }
  } finally {
    env.cleanup();
  }
}

async function scenarioEffort() {
  const env = makeRepo();
  try {
    const dump = join(env.dir, 'argv.json');
    await runScript('delegate.mjs', ['--model', 'claude-opus-4-6-thinking', '--effort', 'high', 'task'], {
      cwd: env.repo,
      env: { CAD_HOME: env.cadHome, AGY_BIN: REPLAY_STUB, AGY_REPLAY: join(REPLAY_DIR, 'rec-000-clean.json'), AGY_REPLAY_ARGV: dump },
    });
    const argv = JSON.parse(spawnSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(dump)},'utf8'))`], { encoding: 'utf8' }).stdout);
    grade('effort', 'claude-opus-4-6-thinking --effort high', !argv.includes('--effort'), `argv has --effort: ${argv.includes('--effort')}`);
  } finally {
    env.cleanup();
  }
}

function killTree(pid) {
  if (typeof pid === 'number') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

async function waitFor(fn, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(200);
  }
  return null;
}

async function scenarioOrphan() {
  const env = makeRepo();
  const stubEnv = { CAD_HOME: env.cadHome, AGY_BIN: REPLAY_STUB, AGY_REPLAY: join(REPLAY_DIR, 'rec-000-clean.json'), AGY_REPLAY_HANG: '1' };
  let live;
  try {
    // Orphan: the wrapper dies (as it does when its Claude session goes away).
    let wrapper;
    const orphanRun = runScript('delegate.mjs', ['orphan job'], { cwd: env.repo, env: stubEnv, onSpawn: (c) => (wrapper = c) });
    const orphan = await waitFor(() => readJobs(env.cadHome).find((j) => j.prompt === 'orphan job' && j.cliPid));
    wrapper.kill();
    await orphanRun;
    killTree(orphan?.cliPid);
    await sleep(1500);
    const after = readJobs(env.cadHome).find((j) => j.prompt === 'orphan job');
    grade('orphan', 'wrapper killed mid-run', after?.status !== 'running', `record status ${after?.status}`);

    // A second job that is actually alive, then a bare cancel.
    live = runScript('delegate.mjs', ['live job'], { cwd: env.repo, env: stubEnv });
    const liveRec = await waitFor(() => readJobs(env.cadHome).find((j) => j.prompt === 'live job' && j.cliPid));
    const cancel = await runScript('cancel.mjs', [], { cwd: env.repo, env: { CAD_HOME: env.cadHome } });
    const cancelled = readJobs(env.cadHome).find((j) => j.prompt === 'live job')?.status === 'cancelled';
    grade('bareCancel', 'one orphan + one live job', cancel.code === 0 && cancelled, `exit ${cancel.code}: ${(cancel.stdout + cancel.stderr).trim().slice(0, 140)}`);
    if (!cancelled) {
      await runScript('cancel.mjs', [liveRec.id], { cwd: env.repo, env: { CAD_HOME: env.cadHome } });
    }
    await live;
  } finally {
    env.cleanup();
  }
}

async function scenarioCrossRepo() {
  const a = makeRepo();
  const b = makeRepo();
  try {
    const shared = { CAD_HOME: a.cadHome, AGY_BIN: REPLAY_STUB, AGY_REPLAY: join(REPLAY_DIR, 'rec-000-clean.json') };
    await runScript('delegate.mjs', ['repo a task'], { cwd: a.repo, env: shared });
    const job = readJobs(a.cadHome)[0];
    const suffix = job.id.split('-').pop();
    const res = await runScript('result.mjs', [suffix], { cwd: b.repo, env: { CAD_HOME: a.cadHome } });
    grade('crossRepo', `suffix ${suffix} looked up from another repo`, res.code !== 0, `exit ${res.code}: ${(res.stdout + res.stderr).trim().slice(0, 120)}`);
  } finally {
    a.cleanup();
    b.cleanup();
  }
}

async function scenarioBareResume() {
  const env = makeRepo();
  try {
    const base = { CAD_HOME: env.cadHome, AGY_BIN: REPLAY_STUB };
    const neverStarted = loadReplayFixtures().find((f) => f.truth.class === 'never-started');
    await runScript('delegate.mjs', ['first task'], { cwd: env.repo, env: { ...base, AGY_REPLAY: join(REPLAY_DIR, 'rec-000-clean.json') } });
    await sleep(1100);
    await runScript('delegate.mjs', ['second task'], { cwd: env.repo, env: { ...base, AGY_REPLAY: neverStarted.path } });
    const dump = join(env.dir, 'argv.json');
    await runScript('resume.mjs', ['follow', 'up'], { cwd: env.repo, env: { ...base, AGY_REPLAY: join(REPLAY_DIR, 'rec-000-clean.json'), AGY_REPLAY_ARGV: dump } });
    const argv = JSON.parse(spawnSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(dump)},'utf8'))`], { encoding: 'utf8' }).stdout);
    grade('bareResume', 'newest job never started', argv.includes('--conversation') && !argv.includes('--continue'), `argv: ${argv.filter((x) => x.startsWith('--')).join(' ')}`);
  } finally {
    env.cleanup();
  }
}

async function scenarioMentionsFile() {
  const env = makeRepo();
  try {
    const fx = join(env.dir, 'mentions.json');
    writeFileSync(fx, JSON.stringify({
      exitCode: 0,
      stderr: [],
      events: [
        { event: 'init', conversation_id: '00000000-0000-0000-0000-000000000001', init: { model: 'gemini-3.8-flash-medium', permission_mode: 'always-proceed' } },
        { event: 'result', result: { conversation_id: '00000000-0000-0000-0000-000000000001', status: 'SUCCESS', response: 'Research done. I wrote the report to C:/Users/USER/scratchpad/report.md as asked.' } },
      ],
    }), 'utf8');
    const run = await runScript('delegate.mjs', ['write a report to the scratchpad'], { cwd: env.repo, env: { CAD_HOME: env.cadHome, AGY_BIN: REPLAY_STUB, AGY_REPLAY: fx } });
    const warns = warnLines(run.stdout);
    grade('mentionsFile', 'report written outside the repo, as briefed', warns.length === 0, warns.join(' | ').slice(0, 140));
  } finally {
    env.cleanup();
  }
}

describe('eval: reporting accuracy', () => {
  let out;

  beforeAll(async () => {
    const fixtures = loadReplayFixtures();
    const replays = await pool(fixtures, 8, replayCase);
    for (const r of replays) gradeReplay(r);
    await scenarioParallel();
    await scenarioEffort();
    await scenarioOrphan();
    await scenarioCrossRepo();
    await scenarioBareResume();
    await scenarioMentionsFile();
    const byClass = {};
    for (const f of fixtures) byClass[f.truth.class] = (byClass[f.truth.class] ?? 0) + 1;
    out = results.summarise(Object.values(checks), {
      preamble: `${fixtures.length} replayed runs: ${Object.entries(byClass).map(([k, v]) => `${k} ${v}`).join(', ')}. Plus six scripted scenarios.`,
      data: { fixtures: byClass },
    });
  }, 600_000);

  afterAll(() => {
    if (out) console.log(`\nreporting eval summary: ${join(out.dir, 'summary.md')}`);
  });

  for (const c of Object.values(checks)) {
    it(`${c.title}${c.flaw ? ` (${c.flaw})` : ''}`, () => {
      const failed = c.results.filter((r) => !r.pass).map((r) => `${r.case}: ${r.detail}`);
      expect(c.results.length, 'no cases reached this check').toBeGreaterThan(0);
      expect(failed).toEqual([]);
    });
  }
});
