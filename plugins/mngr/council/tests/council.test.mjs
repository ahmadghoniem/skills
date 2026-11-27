import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main as round } from '../round.mjs';
import { agyQuotaLeft, codexQuotaLeft, grokQuotaLeft, main as roster } from '../roster.mjs';
import { main as check } from '../check.mjs';
import { seatArgs, sessionFrom } from '../lib/members.mjs';
import { rosterOf } from '../lib/council.mjs';

const STUB = fileURLToPath(new URL('./fixtures/member-stub.mjs', import.meta.url));
const AGY_STUB = fileURLToPath(new URL('./fixtures/agy-member.mjs', import.meta.url));
const saved = { ...process.env };
const prevCwd = process.cwd();
let dir;
let repo;

async function capture(fn) {
  const out = [];
  const err = [];
  const o = process.stdout.write;
  const e = process.stderr.write;
  process.stdout.write = (s) => (out.push(String(s)), true);
  process.stderr.write = (s) => (err.push(String(s)), true);
  try {
    return { code: await fn(), stdout: out.join(''), stderr: err.join('') };
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
}

function council(seats, { chair = true, approved = true } = {}) {
  mkdirSync(join(dir, 'home', 'c1'), { recursive: true });
  writeFileSync(join(dir, 'home', 'c1', 'council.json'), JSON.stringify({ seats, ...(approved ? { approved: rosterOf(seats) } : {}) }));
  if (chair) writeFileSync(join(dir, 'home', 'c1', 'chair.md'), 'My position.');
}
const state = () => JSON.parse(readFileSync(join(dir, 'home', 'c1', 'council.json'), 'utf8'));
const calls = () => readFileSync(join(dir, 'stub.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
function brief(text) {
  const p = join(dir, `brief-${Math.random()}.md`);
  writeFileSync(p, text);
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'council-test-'));
  repo = join(dir, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(repo, 'a.txt'), 'a');
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: repo });
  process.chdir(repo);
  Object.assign(process.env, {
    COUNCIL_HOME: join(dir, 'home'),
    COUNCIL_GROK_DELEGATE: STUB,
    COUNCIL_AGY_DELEGATE: AGY_STUB,
    COUNCIL_OPENCODE_DELEGATE: STUB,
    // No grok sign-in here, so the roster never calls grok's billing endpoint.
    COUNCIL_GROK_HOME: join(dir, 'no-grok'),
    STUB_LOG: join(dir, 'stub.jsonl'),
  });
});
afterEach(() => {
  process.chdir(prevCwd);
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
});

describe('members', () => {
  it('always passes an exact model, continues each member with its own flag and reads its id line', () => {
    expect(seatArgs({ member: 'agy', model: 'gemini-4-neon-high', session: 'c1' }, 'b.md')).toEqual(['--prompt-file', 'b.md', '--model', 'gemini-4-neon-high', '--conversation', 'c1']);
    expect(seatArgs({ member: 'grok', effort: 'low', session: 's1' }, 'b.md')).toEqual(['--prompt-file', 'b.md', '--model', 'grok-4.7', '--effort', 'low', '--session', 's1']);
    expect(seatArgs({ member: 'opencode', effort: 'high' }, 'b.md')).toEqual(['--prompt-file', 'b.md', '--model', 'meta/muse-wonder-1.0#high']);
    expect(sessionFrom('agy', 'x\n\nconversation: abc\n')).toBe('abc');
    expect(sessionFrom('grok', 'conversation: abc\n')).toBeNull();
  });
});

describe('round.mjs', () => {
  it('runs every core seat at once on frozen code, keeps their sessions, and prints their blocks', async () => {
    council([{ name: 'g', member: 'grok', model: 'one' }, { name: 'n', member: 'agy', model: 'two' }, { name: 'aud', member: 'opencode', auditor: true }]);
    const r = await capture(() => round(['--council', 'c1', '--brief', brief('Is X right?')]));
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/frozen at commit [0-9a-f]{7}/);
    const label = (name) => state().seats.find((s) => s.name === name).label;
    expect(r.stdout).toContain(`- **n** (Seat ${label('n')}, agy, two): answered`);
    expect(state().seats.map((s) => s.label).sort()).toEqual(['A', 'B', 'C']);
    expect(r.stdout).toContain('Position: two says yes');
    expect(r.stdout).not.toContain('**aud**');
    const sent = calls();
    expect(sent).toHaveLength(2);
    expect(sent[0].brief).toContain('Is X right?');
    expect(sent[0].brief).toContain('=== FINAL ANSWER ===');
    expect(sent[0].brief).toContain('Do not modify');
    expect(state().seats.map((s) => s.session)).toEqual(['grok-one', 'agy-two', undefined]);
    expect(state().rounds).toBe(1);
  });

  it('sends round 2 only the delta, plus the other seats\' blocks, on the same sessions', async () => {
    council([{ name: 'g', member: 'grok', model: 'one' }, { name: 'n', member: 'agy', model: 'two' }]);
    await capture(() => round(['--council', 'c1', '--brief', brief('FIRST BRIEF')]));
    await capture(() => round(['--council', 'c1', '--brief', brief('D1 is open')]));
    const r2 = calls().slice(2);
    const g = r2.find((c) => c.member === 'grok');
    expect(g.session).toBe('grok-one');
    expect(g.brief).toContain('D1 is open');
    expect(g.brief).not.toContain('FIRST BRIEF');
    const n = state().seats.find((s) => s.name === 'n');
    expect(g.brief).toContain(`### Seat ${n.label} (read the repo; had web search)`);
    expect(g.brief).toContain(`You are Seat ${state().seats.find((s) => s.name === 'g').label}.`);
    expect(g.brief).not.toMatch(/\bagy\b|\btwo \(|### n\b/);
    expect(g.brief).toContain('Position: two says yes');
    expect(g.brief).not.toContain('Position: one says yes');
  });

  it('stops a seat at the timeout, marks it MISSING, and gives it the first brief again next round', async () => {
    council([{ name: 'fast', member: 'grok', model: 'one' }, { name: 'late', member: 'grok', model: 'slow' }]);
    const r = await capture(() => round(['--council', 'c1', '--brief', brief('FIRST BRIEF'), '--timeout-min', '0.05']));
    expect(r.stdout).toMatch(/\*\*late\*\* \(Seat [AB], grok, slow\): MISSING/);
    expect(state().seats[1].session).toBeUndefined();
    await capture(() => round(['--council', 'c1', '--brief', brief('delta'), '--seats', 'late', '--timeout-min', '0.05']));
    const last = calls().at(-1);
    expect(last.brief).toContain('FIRST BRIEF');
    expect(last.brief).toContain('## Since then (round 2)');
  });

  it('flags a seat with no final block, and a workspace that changed during the round', async () => {
    council([{ name: 'quiet', member: 'grok', model: 'noblock' }, { name: 'editor', member: 'grok', model: 'edit' }]);
    const r = await capture(() => round(['--council', 'c1', '--brief', brief('q')]));
    expect(r.stdout).toMatch(/\*\*quiet\*\* \(Seat [AB], grok, noblock\): answered without a final answer block/);
    expect(r.stdout).toContain('⚠ The workspace changed during the round');
    expect(r.stdout).toContain('touched.txt');
  });

  it('flags a second edit to a file that was already uncommitted', async () => {
    writeFileSync(join(repo, 'touched.txt'), 'before');
    council([{ name: 'editor', member: 'grok', model: 'edit' }]);
    const r = await capture(() => round(['--council', 'c1', '--brief', brief('q')]));
    expect(r.stdout).toContain('plus 1 uncommitted file(s)');
    expect(r.stdout).toMatch(/workspace changed during the round[^\n]*\n\s+touched\.txt/);
  });

  it('watches a folder outside git for edits', async () => {
    const plain = join(dir, 'plain');
    mkdirSync(plain);
    writeFileSync(join(plain, 'a.txt'), 'a');
    process.chdir(plain);
    council([{ name: 'editor', member: 'grok', model: 'edit' }]);
    const r = await capture(() => round(['--council', 'c1', '--brief', brief('q')]));
    expect(r.stdout).toContain('not a git repository; the code is frozen as it is now');
    expect(r.stdout).toMatch(/workspace changed during the round[^\n]*\n\s+touched\.txt/);
  });

  it('refuses round 1 until the chair has written chair.md', async () => {
    council([{ name: 'g', member: 'grok', model: 'one' }], { chair: false });
    const r = await capture(() => round(['--council', 'c1', '--brief', brief('q')]));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('chair.md');
    expect(existsSync(join(dir, 'stub.jsonl'))).toBe(false);
  });

  it('refuses round 1 until the user has approved the roster, and again after a seat changes', async () => {
    council([{ name: 'g', member: 'grok', model: 'one' }], { approved: false });
    const r = await capture(() => round(['--council', 'c1', '--brief', brief('q')]));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('not approved');
    process.env.COUNCIL_GROK_CLI = 'git';
    await capture(() => roster(['--council', 'c1', '--approve']));
    const c = state();
    c.seats[0].model = 'two';
    writeFileSync(join(dir, 'home', 'c1', 'council.json'), JSON.stringify(c));
    const r2 = await capture(() => round(['--council', 'c1', '--brief', brief('q')]));
    expect(r2.code).toBe(2);
    expect(r2.stderr).toContain('roster changed');
    expect(existsSync(join(dir, 'stub.jsonl'))).toBe(false);
  });

  it('refuses unknown seats and members before starting anything', async () => {
    council([{ name: 'g', member: 'grok' }]);
    expect((await capture(() => round(['--council', 'c1', '--brief', brief('q'), '--seats', 'nope']))).code).toBe(2);
    council([{ name: 'g', member: 'nope' }]);
    expect((await capture(() => round(['--council', 'c1', '--brief', brief('q')]))).code).toBe(2);
    expect(existsSync(join(dir, 'stub.jsonl'))).toBe(false);
  });
});

describe('check.mjs', () => {
  const LOG = '# Disputes\n\n### D1: is X safe? (OPEN)\nA: yes, a.mjs:3\nB: no, b.mjs:9\n\n### D2: rename it (CLOSED)\nclosed by c.mjs:1\n\n## Parking lot\n- later\n';
  const write = (name, text) => writeFileSync(join(dir, 'home', 'c1', name), text);

  it('passes when every OPEN dispute is copied word for word, and names the ones that are not', async () => {
    council([{ name: 'g', member: 'grok' }]);
    write('disputes.md', LOG);
    write('report.md', '## For your decision\n\n### D1: is X safe? (OPEN)\r\nA: yes, a.mjs:3  \nB: no, b.mjs:9\n');
    expect((await capture(() => check(['--council', 'c1']))).code).toBe(0);
    write('report.md', '## For your decision\n\n### D1: is X safe? (OPEN)\nA: yes\nB: no, b.mjs:9\n');
    const r = await capture(() => check(['--council', 'c1']));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('D1');
    expect(r.stdout).not.toContain('D2');
  });

  it('refuses when there is no report yet', async () => {
    council([{ name: 'g', member: 'grok' }]);
    expect((await capture(() => check(['--council', 'c1']))).code).toBe(2);
  });
});

describe('roster.mjs', () => {
  it('shows model, effort and the last quota error per seat', async () => {
    const cad = join(dir, 'cad');
    mkdirSync(cad);
    writeFileSync(join(cad, 'quota.json'), JSON.stringify({ 'gemini-4-neon-high': { at: '2026-11-24T01:00:00.000Z', message: 'Individual quota reached.', resetsAt: '2999-01-01T00:00:00.000Z' } }));
    process.env.MNGR_AGY_HOME = cad;
    process.env.COUNCIL_GROK_CLI = process.env.COUNCIL_AGY_CLI = 'git';
    council([{ name: 'neon', member: 'agy', model: 'gemini-4-neon-high' }, { name: 'g', member: 'grok', effort: 'low' }]);
    const r = await capture(() => roster(['--council', 'c1']));
    expect(r.stdout).toContain('| neon | core | agy | gemini-4-neon-high | high |');
    expect(r.stdout).toContain('Individual quota reached., blocked until 2999-01-01 00:00 UTC');
    expect(r.stdout).toContain('| g | core | grok | grok-4.7 | low |');
  });

  it('has no standing seats: a council must be named', async () => {
    const r = await capture(() => roster([]));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--council');
  });

  it("reads what agy has left for the seat model's group", () => {
    const bucket = (window, remaining_fraction, reset_time) => ({ window, remaining_fraction, reset_time });
    const usage = { command: { data: { groups: [
      { name: 'Gemini Models', buckets: [bucket('weekly', 0.9991, '2026-12-03T18:35:20Z'), bucket('5h', 1, '1970-01-01T00:00:00Z')] },
      { name: 'Claude and GPT models', buckets: [bucket('weekly', 0.5, '2026-12-01T00:00:00Z')] },
    ] } } };
    expect(agyQuotaLeft(usage, 'gemini-4-neon-high')).toBe('left: 99% weekly (full 2026-12-03 18:35 UTC), 100% 5-hour');
    expect(agyQuotaLeft(usage, 'claude-opus-5-5')).toBe('left: 50% weekly (full 2026-12-01 00:00 UTC)');
    expect(agyQuotaLeft(null, 'gemini-4-neon-high')).toBeNull();
  });

  it('reads what grok has left this week from its billing response', () => {
    const billing = (creditUsagePercent) => ({ config: {
      currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-11-23T20:11:26.718+00:00', end: '2026-11-30T20:11:26.718+00:00' },
      creditUsagePercent,
      productUsage: [{ product: 'GrokBuild', usagePercent: 74 }, { product: 'GrokChat', usagePercent: 4 }],
    } });
    expect(grokQuotaLeft(billing(78))).toBe('left: 22% weekly (full 2026-11-30 20:11 UTC)');
    expect(grokQuotaLeft(billing(0))).toBe('left: 100% weekly');
    expect(grokQuotaLeft(billing(104))).toBe('left: 0% weekly (full 2026-11-30 20:11 UTC)');
    expect(grokQuotaLeft(null)).toBeNull();
    expect(grokQuotaLeft({ config: {} })).toBeNull();
  });

  it('reads what codex has left in its 5-hour and weekly windows from the app server', () => {
    const limits = { rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1795803674 }, secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1796322374 } } };
    expect(codexQuotaLeft(limits)).toBe('left: 90% 5-hour (full 2026-11-27 18:21 UTC), 100% weekly');
    expect(codexQuotaLeft(null)).toBeNull();
    expect(codexQuotaLeft({ rateLimits: {} })).toBeNull();
  });
});
