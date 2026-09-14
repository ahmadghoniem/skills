// Eval 3: does Claude Code use the plugin the way the plugin asks to be used?
//
// Live: spends Claude usage through `claude -p`. Skipped unless AGY_EVAL_LIVE=1.
// agy itself is replaced by the replay stub, so outcomes are fixed and no agy
// quota is spent; the stub waits before exiting so there is time to poll.
//
// Each case runs a fresh headless Claude Code session in a throwaway repo with
// the installed agy plugin, and grades its transcript (stream-json, subagents
// included) and the plugin's job files:
//   dispatched   delegate.mjs was invoked
//   background   every delegate.mjs call used run_in_background
//   noPolling    no sleep/wait loops, no reads of job logs, no /agy:result
//                while the job was still running
//   relayed      the final answer carries what the ⚠ lines said (warning cases)
//   briefIntact  the sidecar prompt agy read contains the end of a long brief
//   noToolErrors no Bash call failed on the way to dispatch
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIVE, REPLAY_DIR, REPLAY_STUB, makeRepo, openResults, pool } from './lib/harness.mjs';

const STUB_DELAY_MS = '45000';
// The npm shim is a .cmd, which cannot be spawned without a shell; use the exe behind it.
const CLAUDE_BIN =
  process.env.CLAUDE_BIN ||
  join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');

const RANGE_FILES = {
  'src/range.mjs': 'export function range(start, end) {\n  const out = [];\n  for (let i = start; i < end - 1; i++) out.push(i);\n  return out;\n}\n',
  'test.mjs': "import assert from 'node:assert/strict';\nimport { range } from './src/range.mjs';\nassert.deepEqual(range(0, 3), [0, 1, 2]);\nconsole.log('ok');\n",
};

const SENTINEL = 'FINAL-REQUIREMENT-ZEBRA-42';
const longSpec = () => {
  const reqs = [];
  for (let i = 1; i <= 60; i++) {
    reqs.push(`${i}. The exported function number ${i} in src/lib${i % 6}.mjs must validate its input, throw a TypeError naming the argument when it is not a finite number, and return the value rounded to ${i % 4} decimal places using banker's rounding; document the behaviour in a JSDoc block.`);
  }
  reqs.push(`61. Put the literal marker ${SENTINEL} as a comment at the top of src/lib0.mjs.`);
  return reqs.join('\n');
};

const FIXED_RANGE = JSON.stringify({ 'src/range.mjs': RANGE_FILES['src/range.mjs'].replace('end - 1', 'end') });
const DONE = { AGY_REPLAY_FILES: FIXED_RANGE, AGY_REPLAY_RESPONSE: 'Fixed the loop bound in src/range.mjs. node test.mjs now prints ok.' };

const firstFixture = (cls) => readdirSync(REPLAY_DIR).find((f) => f.includes(`-${cls}`));

const CASES = [
  {
    id: 'simple-delegation',
    files: RANGE_FILES,
    fixture: 'rec-000-clean.json',
    prompt: 'Use agy to fix the off-by-one bug in src/range.mjs so that node test.mjs passes. Tell me when it is done.',
    stub: DONE,
    checks: ['dispatched', 'background', 'jobSurvived', 'noPolling', 'noToolErrors'],
  },
  {
    id: 'timeout-on-1.2.2',
    files: RANGE_FILES,
    fixture: 'live-timeout-1.2.2.json',
    prompt: 'Delegate this to agy: fix the off-by-one bug in src/range.mjs so node test.mjs passes. Report back what agy did.',
    checks: ['dispatched', 'background', 'jobSurvived', 'noPolling', 'toldIncomplete'],
  },
  {
    id: 'warnings-relayed',
    files: RANGE_FILES,
    fixture: firstFixture('stream-drop'),
    prompt: 'Have agy fix the off-by-one bug in src/range.mjs so node test.mjs passes, and give me its report.',
    stub: { AGY_REPLAY_RESPONSE: 'I read src/range.mjs and started on the fix, but the model provider failed before I could write it.' },
    checks: ['dispatched', 'background', 'jobSurvived', 'noPolling', 'relayed'],
  },
  {
    id: 'long-brief',
    files: { 'src/lib0.mjs': 'export {};\n', 'README.md': '# libs\n' },
    fixture: 'rec-000-clean.json',
    prompt: `Delegate the following spec to agy in one job, passing every requirement through exactly as written:\n\n${longSpec()}`,
    stub: { AGY_REPLAY_RESPONSE: 'Implemented all 61 requirements.' },
    checks: ['dispatched', 'background', 'jobSurvived', 'briefIntact', 'noToolErrors'],
  },
  {
    id: 'three-in-parallel',
    files: { ...RANGE_FILES, 'src/a.mjs': 'export const a = 1;\n', 'src/b.mjs': 'export const b = 2;\n' },
    fixture: 'rec-000-clean.json',
    prompt: 'Use agy for three independent jobs at the same time: (1) fix the off-by-one in src/range.mjs, (2) add a JSDoc comment to src/a.mjs, (3) add a JSDoc comment to src/b.mjs. Tell me when all three are done.',
    stub: { ...DONE, AGY_REPLAY_RESPONSE: 'Done. The change is in the working tree.' },
    checks: ['dispatchedThree', 'background', 'jobSurvived', 'noPolling'],
  },
  {
    id: 'runner-subagent',
    files: RANGE_FILES,
    fixture: 'rec-000-clean.json',
    prompt: 'Use the agy-runner subagent to get the off-by-one in src/range.mjs fixed so node test.mjs passes.',
    stub: DONE,
    checks: ['dispatched', 'background', 'jobSurvived', 'noPolling', 'noToolErrors'],
  },
];

// A plain `claude -p` may exit before a background task notifies, so the session
// runs in stream-json input mode and stdin stays open until every background
// task it started has notified and the turn after that has finished.
function runClaude(prompt, cwd, env) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(CLAUDE_BIN, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--no-session-persistence'], {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n');
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
        if (e.type === 'result' && tasksNotified >= tasksStarted && !closedInput) {
          closedInput = true;
          child.stdin.end();
        }
      }
    });
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 25 * 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, ms: Date.now() - started });
    });
  });
}

function parseStream(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // ignore
    }
  }
  const toolUses = [];
  const toolResults = new Map();
  const results = [];
  // Final status of each backgrounded tool call, and how many background tasks
  // were running when each tool call was made.
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
  return { events, toolUses, toolResults, results, taskStatus };
}

const cmdOf = (t) => String(t.input?.command ?? '');
// A dispatch runs delegate.mjs or resume.mjs, directly or through a script the session wrote.
const launchers = new Set();
const isDelegate = (t) =>
  ['Bash', 'PowerShell'].includes(t.name) &&
  (/delegate\.mjs|resume\.mjs/.test(cmdOf(t)) || [...launchers].some((f) => cmdOf(t).includes(f)));

function jobFiles(cadHome) {
  const root = join(cadHome, 'jobs');
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((d) => readdirSync(join(root, d)).map((f) => join(root, d, f)));
}

const TITLES = {
  dispatched: 'Delegation dispatched',
  dispatchedThree: 'Three delegations dispatched',
  background: 'Every dispatch backgrounded',
  noPolling: 'No polling or live-log reading',
  toldIncomplete: 'User told the run did not finish',
  relayed: 'Warnings relayed to the user',
  briefIntact: 'Long brief reached agy intact',
  noToolErrors: 'No failed Bash call before dispatch',
  jobSurvived: 'Dispatched job ran to completion',
};
const FLAWS = { jobSurvived: 'F21', noPolling: 'F19', briefIntact: 'F14', noToolErrors: 'F14', toldIncomplete: 'F1', relayed: 'contract' };

describe.skipIf(!LIVE)('eval: caller behaviour (live Claude Code, stub agy)', () => {
  const results = openResults('caller');
  const checks = Object.fromEntries(Object.entries(TITLES).map(([id, title]) => [id, { id, title, flaw: FLAWS[id], results: [] }]));
  let out;

  beforeAll(async () => {
    // AGY_EVAL_CASES=id,id reruns a subset, e.g. after a usage limit cut a run short.
    const only = (process.env.AGY_EVAL_CASES ?? "").split(",").filter(Boolean);
    const selected = only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;
    const rows = await pool(selected, 2, async (c) => {
      const env = makeRepo(c.files);
      try {
        const fixturePath = join(REPLAY_DIR, c.fixture);
        const run = await runClaude(c.prompt, env.repo, {
          CAD_HOME: env.cadHome,
          AGY_BIN: REPLAY_STUB,
          AGY_REPLAY: fixturePath,
          AGY_REPLAY_DELAY_MS: STUB_DELAY_MS,
          ...(c.stub ?? {}),
        });
        writeFileSync(join(results.dir, `${c.id}.stream.ndjson`), run.stdout, 'utf8');
        const s = parseStream(run.stdout);
        launchers.clear();
        for (const t of s.toolUses) {
          if (t.name === 'Write' && /delegate\.mjs/.test(String(t.input?.content ?? ''))) {
            launchers.add(String(t.input.file_path).split(/[\\/]/).pop());
          }
        }
        const delegates = s.toolUses.filter(isDelegate);
        const finalText = String(s.results.at(-1)?.result ?? '');
        const cost = s.results.reduce((sum, r) => sum + (r.total_cost_usd ?? 0), 0);
        const files = jobFiles(env.cadHome);
        const jobCount = files.filter((f) => f.endsWith('.prompt.md')).length;
        const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

        const grades = {};
        grades.dispatched = [jobCount >= 1, `${jobCount} job(s), ${delegates.length} dispatch call(s)`];
        grades.dispatchedThree = [jobCount >= 3, `${jobCount} job(s), ${delegates.length} dispatch call(s)`];
        grades.background = [delegates.length > 0 && delegates.every((t) => t.input?.run_in_background === true), delegates.map((t) => `bg=${t.input?.run_in_background}`).join(', ')];
        const bg = delegates.filter((t) => t.input?.run_in_background === true);
        grades.jobSurvived = [bg.length > 0 && bg.every((t) => s.taskStatus.get(t.id) === 'completed'), bg.map((t) => s.taskStatus.get(t.id) ?? 'no notification').join(', ')];

        // Only calls made while a background job was still running count as polling.
        const pollers = s.toolUses.filter((t) => {
          if (t.running === 0 || isDelegate(t)) return false;
          const cmd = cmdOf(t);
          if (t.name === 'Bash' && !isDelegate(t) && /\bsleep\b|until\s|while\s|Start-Sleep|timeout\s+\d|result\.mjs|\.ndjson|\.agy\.log|[\\/]\.cad[\\/]|CAD_HOME/i.test(cmd)) return true;
          if (t.name === 'PowerShell' && /Start-Sleep|Get-Content.*(\.ndjson|\.log)|result\.mjs/i.test(cmd)) return true;
          if (t.name === 'Read' && /\.ndjson$|\.agy\.log$|[\\/]jobs[\\/].*\.json$/i.test(String(t.input?.file_path ?? ''))) return true;
          if (t.name === 'Monitor') return true;
          return false;
        });
        grades.noPolling = [pollers.length === 0, pollers.map((t) => `${t.name}: ${(cmdOf(t) || t.input?.file_path || JSON.stringify(t.input)).slice(0, 100)}`).join(' || ') || 'none'];

        grades.toldIncomplete = [/time[sd]? ?out|timed out|did not finish|didn't finish|incomplete|partial|unfinished|cut off|ran out of time/i.test(finalText), finalText.slice(0, 200)];

        const errorLine = String(fixture.events.find((e) => e.event === 'result')?.result?.error ?? '').split('\n')[0];
        const key = errorLine.split(/[.:]/)[0].trim().slice(0, 40);
        grades.relayed = [key.length > 0 && finalText.toLowerCase().includes(key.toLowerCase()) && /ERROR/.test(finalText), `looked for "${key}" and ERROR; final: ${finalText.slice(0, 160)}`];

        const prompts = files.filter((f) => f.endsWith('.prompt.md')).map((f) => readFileSync(f, 'utf8'));
        grades.briefIntact = [prompts.some((p) => p.includes(SENTINEL)), `${prompts.length} sidecar(s), sentinel ${prompts.some((p) => p.includes(SENTINEL)) ? 'found' : 'missing'}`];

        const firstDispatch = delegates[0]?.index ?? Infinity;
        const failedBefore = s.toolUses.filter((t) => ['Bash', 'PowerShell', 'Write'].includes(t.name) && t.index < firstDispatch && s.toolResults.get(t.id)?.is_error);
        grades.noToolErrors = [failedBefore.length === 0, failedBefore.map((t) => `${t.name}: ${cmdOf(t).slice(0, 80)}`).join(' || ') || 'none'];

        const row = {
          case: c.id,
          exit: run.code,
          wallSeconds: Math.round(run.ms / 1000),
          costUsd: Number(cost.toFixed(4)),
          toolCalls: s.toolUses.length,
          delegateCalls: delegates.length,
          grades: Object.fromEntries(c.checks.map((k) => [k, grades[k]])),
          finalText: finalText.slice(0, 3000),
        };
        results.row(row);
        return { c, row, grades };
      } finally {
        env.cleanup();
      }
    });

    for (const { c, grades } of rows) {
      for (const k of c.checks) checks[k].results.push({ case: c.id, pass: grades[k][0], detail: grades[k][1] });
    }
    const cost = rows.reduce((s, r) => s + r.row.costUsd, 0);
    out = results.summarise(Object.values(checks).filter((x) => x.results.length), {
      preamble: `${rows.length} headless Claude Code sessions against the stub agy (${Number(STUB_DELAY_MS) / 1000} s per job). Reported cost ${cost.toFixed(2)} USD. Transcripts: <case>.stream.ndjson in this folder.`,
    });
  }, 3_600_000);

  afterAll(() => {
    if (out) console.log(`\ncaller eval summary: ${join(out.dir, 'summary.md')}`);
  });

  for (const [id, title] of Object.entries(TITLES)) {
    it(`${title}${FLAWS[id] ? ` (${FLAWS[id]})` : ''}`, () => {
      const c = checks[id];
      if (!c.results.length) return;
      expect(c.results.filter((r) => !r.pass).map((r) => `${r.case}: ${r.detail}`)).toEqual([]);
    });
  }
});
