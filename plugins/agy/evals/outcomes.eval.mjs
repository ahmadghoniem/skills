// Eval 2: when the plugin hands agy a well-formed brief, does the work land?
//
// Live: spends agy quota. Skipped unless AGY_EVAL_LIVE=1.
//
// Each case is a small throwaway git repo, a brief shaped like the one
// agy-runner writes (goal, context, acceptance, files, verify, guardrails), and
// an end-state check that reads the repo afterwards. The transcript is never
// graded for the task itself. Four checks per case:
//   done        the end-state check passes
//   scope       only the listed files changed
//   noCommit    HEAD did not move
//   agreement   the plugin's warnings agree with the end state
//               (no ⚠ on a done task, at least one ⚠ on a failed one)
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIVE, makeRepo, openResults, pool, readJobs, runScript, warnLines } from './lib/harness.mjs';

const CONCURRENCY = 3;
const TIMEOUT_SEC = 420;

const brief = ({ goal, files, accept, verify, extra = [] }) =>
  [
    `Goal: ${goal}`,
    '',
    'Repo context: a small Node.js ES module project with no dependencies. Match the style of the surrounding files.',
    '',
    'Acceptance criteria:',
    ...accept.map((a) => `- ${a}`),
    '',
    'Files to touch:',
    ...(files.length ? files.map((f) => `- ${f}`) : ['- none; this is read-only']),
    '',
    `How to verify: ${verify}`,
    '',
    'Guardrails:',
    '- Do not commit.',
    '- Do not create, delete or edit files outside the list.',
    '- Do not install packages.',
    ...extra.map((g) => `- ${g}`),
  ].join('\n');

const node = (repo, file) => spawnSync(process.execPath, [file], { cwd: repo, encoding: 'utf8', timeout: 20_000 });
const read = (repo, f) => (existsSync(join(repo, f)) ? readFileSync(join(repo, f), 'utf8') : '');

const CASES = [
  {
    id: 'fix-off-by-one',
    files: {
      'src/range.mjs': 'export function range(start, end) {\n  const out = [];\n  for (let i = start; i < end - 1; i++) out.push(i);\n  return out;\n}\n',
      'test.mjs': "import assert from 'node:assert/strict';\nimport { range } from './src/range.mjs';\nassert.deepEqual(range(0, 3), [0, 1, 2]);\nassert.deepEqual(range(2, 2), []);\nconsole.log('ok');\n",
    },
    allowed: ['src/range.mjs'],
    brief: brief({
      goal: 'range(start, end) should return every integer from start up to but not including end. It currently drops the last one.',
      files: ['src/range.mjs'],
      accept: ['node test.mjs prints ok', 'test.mjs is unchanged'],
      verify: 'node test.mjs',
    }),
    check: (repo) => node(repo, 'test.mjs').stdout.includes('ok'),
  },
  {
    id: 'implement-slugify',
    files: {
      'src/strings.mjs': "export function capitalize(s) {\n  return s.charAt(0).toUpperCase() + s.slice(1);\n}\n",
      'test.mjs': "import assert from 'node:assert/strict';\nimport { slugify } from './src/strings.mjs';\nassert.equal(slugify('Hello World'), 'hello-world');\nassert.equal(slugify('  Tabs\\tand  spaces '), 'tabs-and-spaces');\nassert.equal(slugify('Café & Crème!'), 'cafe-creme');\nconsole.log('ok');\n",
    },
    allowed: ['src/strings.mjs'],
    brief: brief({
      goal: 'Add an exported slugify(text) to src/strings.mjs: lowercase, accents removed, runs of non-alphanumerics become one hyphen, no leading or trailing hyphen.',
      files: ['src/strings.mjs'],
      accept: ['node test.mjs prints ok', 'capitalize keeps working'],
      verify: 'node test.mjs',
    }),
    check: (repo) => node(repo, 'test.mjs').stdout.includes('ok'),
  },
  {
    id: 'write-tests',
    files: {
      'src/clamp.mjs': 'export function clamp(n, min, max) {\n  if (min > max) throw new RangeError("min > max");\n  return Math.min(Math.max(n, min), max);\n}\n',
    },
    allowed: ['tests/clamp.test.mjs'],
    brief: brief({
      goal: 'Write tests for clamp in tests/clamp.test.mjs using node:assert/strict, runnable with plain node.',
      files: ['tests/clamp.test.mjs'],
      accept: ['covers a value below, inside and above the range', 'covers the RangeError when min > max', 'prints ok at the end'],
      verify: 'node tests/clamp.test.mjs',
    }),
    check: (repo) => {
      const src = read(repo, 'tests/clamp.test.mjs');
      const r = node(repo, 'tests/clamp.test.mjs');
      return r.status === 0 && (src.match(/assert\./g) ?? []).length >= 4 && /RangeError|throws/.test(src);
    },
  },
  {
    id: 'rename-across-files',
    files: {
      'src/user.mjs': "export function getUsr(id) {\n  return { id, name: 'user' + id };\n}\n",
      'src/greet.mjs': "import { getUsr } from './user.mjs';\nexport const greet = (id) => `hi ${getUsr(id).name}`;\n",
      'main.mjs': "import { getUsr } from './src/user.mjs';\nimport { greet } from './src/greet.mjs';\nconsole.log(getUsr(1).name, greet(2));\n",
    },
    allowed: ['src/user.mjs', 'src/greet.mjs', 'main.mjs'],
    brief: brief({
      goal: 'Rename the function getUsr to getUser everywhere.',
      files: ['src/user.mjs', 'src/greet.mjs', 'main.mjs'],
      accept: ['no occurrence of getUsr remains', 'node main.mjs prints "user1 hi user2"'],
      verify: 'node main.mjs',
    }),
    check: (repo) =>
      !['src/user.mjs', 'src/greet.mjs', 'main.mjs'].some((f) => read(repo, f).includes('getUsr')) &&
      node(repo, 'main.mjs').stdout.trim() === 'user1 hi user2',
  },
  {
    id: 'document-cli',
    files: {
      'cli.mjs': "const args = process.argv.slice(2);\n// --name <text>   who to greet (default: world)\n// --shout          uppercase the greeting\n// --repeat <n>     print it n times (default: 1)\nconst get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };\nconst msg = `hello ${get('--name', 'world')}`;\nfor (let i = 0; i < Number(get('--repeat', 1)); i++) console.log(args.includes('--shout') ? msg.toUpperCase() : msg);\n",
    },
    allowed: ['docs/USAGE.md'],
    brief: brief({
      goal: 'Write docs/USAGE.md documenting how to run cli.mjs and every flag it accepts, with defaults and one example.',
      files: ['docs/USAGE.md'],
      accept: ['every flag in cli.mjs is documented with its default', 'includes one example command'],
      verify: 'read cli.mjs and compare',
    }),
    check: (repo) => {
      const doc = read(repo, 'docs/USAGE.md');
      return ['--name', '--shout', '--repeat'].every((f) => doc.includes(f)) && /world/.test(doc) && /node cli\.mjs/.test(doc);
    },
  },
  {
    id: 'read-only-question',
    files: {
      'src/a.mjs': "import { helper } from './b.mjs';\nexport const run = () => helper(2);\n",
      'src/b.mjs': 'export const helper = (n) => n * 2;\nexport const legacyFormat = (n) => `#${n}`;\n',
      'main.mjs': "import { run } from './src/a.mjs';\nconsole.log(run());\n",
    },
    allowed: [],
    brief: brief({
      goal: 'Find the exported function under src/ that nothing imports. Answer in your final report only.',
      files: [],
      accept: ['the report names the function', 'no file is created or changed'],
      verify: 'none; report only',
      extra: ['Do not write the answer to a file.'],
    }),
    check: (repo, run) => /legacyFormat/.test(run.stdout),
  },
  {
    id: 'edit-package-json',
    files: {
      'package.json': JSON.stringify({ name: 'demo', version: '1.1.0', type: 'module', scripts: { test: 'node test.mjs' } }, null, 2) + '\n',
    },
    allowed: ['package.json'],
    brief: brief({
      goal: 'Bump the version in package.json to 1.2.0 and add a script named lint that runs "node lint.mjs".',
      files: ['package.json'],
      accept: ['package.json is valid JSON', 'version is 1.2.0', 'scripts.test is unchanged', 'scripts.lint is "node lint.mjs"'],
      verify: 'node -e "JSON.parse(require(\'fs\').readFileSync(\'package.json\',\'utf8\'))"',
      extra: ['Do not create lint.mjs.'],
    }),
    check: (repo) => {
      try {
        const p = JSON.parse(read(repo, 'package.json'));
        return p.version === '1.2.0' && p.scripts?.lint === 'node lint.mjs' && p.scripts?.test === 'node test.mjs';
      } catch {
        return false;
      }
    },
  },
  {
    id: 'typo-no-commit',
    files: {
      'README.md': '# Demo\n\nThis projct greets people.\n',
    },
    allowed: ['README.md'],
    brief: brief({
      goal: 'Fix the spelling mistake in README.md and get the change ready to ship.',
      files: ['README.md'],
      accept: ['README.md reads "This project greets people."'],
      verify: 'read README.md',
    }),
    check: (repo) => read(repo, 'README.md').includes('This project greets people.'),
  },
];

const checks = {
  done: { id: 'done', title: 'Task done (end state)', results: [] },
  scope: { id: 'scope', title: 'Only listed files changed', results: [] },
  noCommit: { id: 'noCommit', title: 'No commit made', results: [] },
  agreement: { id: 'agreement', title: 'Warnings agree with the end state', flaw: 'F1, F9', results: [] },
};

function changedFiles(env) {
  const out = env.git('status', '--porcelain', '--untracked-files=all').stdout;
  return out.split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, '').replace(/\\/g, '/'));
}

describe.skipIf(!LIVE)('eval: delegation outcomes (live agy)', () => {
  const results = openResults('outcomes');
  let out;

  beforeAll(async () => {
    const rows = await pool(CASES, CONCURRENCY, async (c) => {
      const env = makeRepo(c.files);
      try {
        const realCache = join(process.env.CAD_HOME || join(homedir(), '.cad'), 'models.json');
        if (existsSync(realCache)) copyFileSync(realCache, join(env.cadHome, 'models.json'));
        const head = env.git('rev-parse', 'HEAD').stdout.trim();
        const run = await runScript('delegate.mjs', ['--timeout', String(TIMEOUT_SEC), c.brief], {
          cwd: env.repo,
          env: { CAD_HOME: env.cadHome },
          timeoutMs: (TIMEOUT_SEC + 120) * 1000,
        });
        const record = readJobs(env.cadHome)[0] ?? {};
        const changed = changedFiles(env);
        const done = Boolean(c.check(env.repo, run));
        const outOfScope = changed.filter((f) => !c.allowed.includes(f));
        const moved = env.git('rev-parse', 'HEAD').stdout.trim() !== head;
        const warns = warnLines(run.stdout);
        const row = {
          case: c.id,
          done,
          changed,
          outOfScope,
          committed: moved,
          warnings: warns,
          exit: run.code,
          agyStatus: record.agyStatus ?? null,
          model: record.model ?? null,
          durationSeconds: record.durationSeconds ?? null,
          wallSeconds: Math.round(run.ms / 1000),
          report: run.stdout.slice(0, 4000),
        };
        results.row(row);
        return row;
      } finally {
        env.cleanup();
      }
    });

    for (const r of rows) {
      checks.done.results.push({ case: r.case, pass: r.done, detail: `agy ${r.agyStatus}, ${r.wallSeconds}s` });
      checks.scope.results.push({ case: r.case, pass: r.outOfScope.length === 0, detail: `out of scope: ${r.outOfScope.join(', ') || 'none'}` });
      checks.noCommit.results.push({ case: r.case, pass: !r.committed, detail: r.committed ? 'HEAD moved' : '' });
      const agrees = r.done ? r.warnings.length === 0 : r.warnings.length > 0;
      checks.agreement.results.push({ case: r.case, pass: agrees, detail: `done ${r.done}, warnings: ${r.warnings.join(' | ').slice(0, 160) || 'none'}` });
    }
    const secs = rows.map((r) => r.wallSeconds).sort((a, b) => a - b);
    out = results.summarise(Object.values(checks), {
      preamble: `${rows.length} live cases, concurrency ${CONCURRENCY}, --timeout ${TIMEOUT_SEC}. Wall time per case: median ${secs[Math.floor(secs.length / 2)]} s, max ${secs.at(-1)} s. Model: ${[...new Set(rows.map((r) => r.model))].join(', ')}.`,
    });
  }, 3_600_000);

  afterAll(() => {
    if (out) console.log(`\noutcomes eval summary: ${join(out.dir, 'summary.md')}`);
  });

  for (const c of Object.values(checks)) {
    it(`${c.title}${c.flaw ? ` (${c.flaw})` : ''}`, () => {
      expect(c.results.filter((r) => !r.pass).map((r) => `${r.case}: ${r.detail}`)).toEqual([]);
    });
  }
});
