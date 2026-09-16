// Eval 4: does a brief that tells agy to use its own subagents survive?
//
// Live: spends agy quota. Skipped unless AGY_EVAL_LIVE=1.
//
// One audit task over a small repo with three modules, sent two ways: plain,
// and with an instruction to give each module to its own subagent and then
// synthesise. Same repo, same acceptance, REPS runs of each, all dispatched
// together (within the settled fan-out of 3 to 5). The end state is graded:
// AUDIT.md exists with a section per module naming that module's planted
// problems. Duration, agy status and warnings are recorded beside it.
import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIVE, makeRepo, openResults, pool, readJobs, runScript, warnLines } from './lib/harness.mjs';

const REPS = 3;
const TIMEOUT_SEC = 600;

const FILES = {
  'billing/invoice.mjs': "// TODO: handle currency rounding\nexport const total = (items) => items.reduce((s, i) => s + i.price * i.qty, 0);\nexport const unusedTax = (n) => n * 0.2;\n",
  'billing/index.mjs': "export { total } from './invoice.mjs';\n",
  'auth/session.mjs': "export function createSession(user) {\n  // FIXME: tokens never expire\n  return { user, token: Math.random().toString(36) };\n}\nexport const legacyLogin = () => null;\n",
  'auth/index.mjs': "export { createSession } from './session.mjs';\n",
  'search/query.mjs': "export function parse(q) {\n  // TODO: support quoted phrases\n  return q.split(' ');\n}\nexport const oldRanker = (xs) => xs;\n",
  'search/index.mjs': "export { parse } from './query.mjs';\n",
  'main.mjs': "import { total } from './billing/index.mjs';\nimport { createSession } from './auth/index.mjs';\nimport { parse } from './search/index.mjs';\nconsole.log(total([{ price: 2, qty: 3 }]), createSession('a').user, parse('a b'));\n",
};

// What each section must name: the planted comment and the export nothing imports.
const EXPECT = {
  billing: [/rounding/i, /unusedTax/],
  auth: [/expire/i, /legacyLogin/],
  search: [/quoted/i, /oldRanker/],
};

const BASE = [
  'Goal: audit the three modules billing/, auth/ and search/ and write the findings to AUDIT.md.',
  '',
  'Repo context: a small Node.js ES module project with no dependencies.',
  '',
  'Acceptance criteria:',
  '- AUDIT.md has one "## <module>" section for each of billing, auth and search.',
  '- Each section lists every TODO or FIXME comment in that module.',
  '- Each section lists every export in that module that nothing in the repo imports.',
  '',
  'Files to touch:',
  '- AUDIT.md (create it)',
  '',
  'How to verify: re-read AUDIT.md against the source.',
  '',
  'Guardrails:',
  '- Do not commit.',
  '- Do not change any source file.',
].join('\n');

const VARIANTS = {
  plain: BASE,
  subagents: `${BASE}\n\nMethod: spawn one subagent per module (three subagents) to audit that module in parallel, wait for all three, then synthesise their findings into AUDIT.md yourself.`,
};

const checks = {
  plain: { id: 'plain', title: 'Plain brief: AUDIT.md complete', results: [] },
  subagents: { id: 'subagents', title: 'Subagent brief: AUDIT.md complete', flaw: 'F20', results: [] },
  subagentsReported: { id: 'subagentsReported', title: 'Subagent brief: write-up returned', flaw: 'F20', results: [] },
  subagentsUsed: { id: 'subagentsUsed', title: 'Subagent brief: agy actually used subagents', results: [] },
};

function grade(repo) {
  const path = join(repo, 'AUDIT.md');
  if (!existsSync(path)) return { complete: false, missing: ['AUDIT.md'] };
  const doc = readFileSync(path, 'utf8');
  const missing = [];
  for (const [mod, needles] of Object.entries(EXPECT)) {
    const m = doc.match(new RegExp(`##\\s*${mod}[\\s\\S]*?(?=\\n##\\s|$)`, 'i'));
    if (!m) {
      missing.push(`section ${mod}`);
      continue;
    }
    for (const n of needles) if (!n.test(m[0])) missing.push(`${mod}: ${n.source}`);
  }
  return { complete: missing.length === 0, missing };
}

describe.skipIf(!LIVE)('eval: agy subagent fan-out (live agy)', () => {
  const results = openResults('fanout');
  let out;

  beforeAll(async () => {
    const jobs = [];
    for (const v of Object.keys(VARIANTS)) for (let r = 0; r < REPS; r++) jobs.push({ variant: v, rep: r });

    const rows = await pool(jobs, 4, async ({ variant, rep }) => {
      const env = makeRepo(FILES);
      try {
        const realCache = join(process.env.CAD_HOME || join(homedir(), '.cad'), 'models.json');
        if (existsSync(realCache)) copyFileSync(realCache, join(env.cadHome, 'models.json'));
        const run = await runScript('delegate.mjs', ['--timeout', String(TIMEOUT_SEC), VARIANTS[variant]], {
          cwd: env.repo,
          env: { CAD_HOME: env.cadHome },
          timeoutMs: (TIMEOUT_SEC + 120) * 1000,
        });
        const rec = readJobs(env.cadHome)[0] ?? {};
        const g = grade(env.repo);
        // Which subagent tools agy actually called, read from the raw event log.
        const jobsRoot = join(env.cadHome, 'jobs');
        const logText = existsSync(jobsRoot)
          ? readdirSync(jobsRoot).flatMap((d) => readdirSync(join(jobsRoot, d)).filter((f) => f.endsWith('.ndjson')).map((f) => readFileSync(join(jobsRoot, d, f), 'utf8'))).join('\n')
          : '';
        let subagentCalls = 0;
        for (const line of logText.split(/\r?\n/)) {
          if (!line.includes('subagent')) continue;
          try {
            const su = JSON.parse(line).step_update;
            if (su?.step_type === 'tool' && su.state === 'DONE' && /^(invoke|define|manage)_subagents?$/.test(su.tool_name ?? '')) subagentCalls++;
          } catch {
            // partial line
          }
        }
        const row = {
          case: `${variant}#${rep}`,
          variant,
          rep,
          ...g,
          writeUp: Boolean(rec.summary && String(rec.summary).trim()),
          subagentCalls,
          agyStatus: rec.agyStatus ?? null,
          error: rec.error ?? null,
          exit: run.code,
          warnings: warnLines(run.stdout),
          durationSeconds: rec.durationSeconds ?? null,
          wallSeconds: Math.round(run.ms / 1000),
          model: rec.model ?? null,
        };
        results.row(row);
        return row;
      } finally {
        env.cleanup();
      }
    });

    for (const r of rows) {
      const detail = `agy ${r.agyStatus}, ${r.wallSeconds}s, missing: ${r.missing.join('; ') || 'none'}${r.error ? `, error: ${String(r.error).slice(0, 80)}` : ''}`;
      checks[r.variant].results.push({ case: r.case, pass: r.complete, detail });
      if (r.variant === 'subagents') {
        checks.subagentsReported.results.push({ case: r.case, pass: r.writeUp, detail });
        checks.subagentsUsed.results.push({ case: r.case, pass: r.subagentCalls > 0, detail: `${r.subagentCalls} completed subagent tool calls` });
      }
    }
    const med = (v) => {
      const s = rows.filter((r) => r.variant === v).map((r) => r.wallSeconds).sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    out = results.summarise(Object.values(checks), {
      preamble: `${REPS} reps per variant, dispatched together. Median wall time: plain ${med('plain')} s, subagents ${med('subagents')} s. Model: ${[...new Set(rows.map((r) => r.model))].join(', ')}.`,
    });
  }, 3_600_000);

  afterAll(() => {
    if (out) console.log(`\nfanout eval summary: ${join(out.dir, 'summary.md')}`);
  });

  for (const c of Object.values(checks)) {
    it(`${c.title}${c.flaw ? ` (${c.flaw})` : ''}`, () => {
      expect(c.results.filter((r) => !r.pass).map((r) => `${r.case}: ${r.detail}`)).toEqual([]);
    });
  }
});
