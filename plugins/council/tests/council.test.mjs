import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main as round } from '../scripts/round.mjs';
import { main as roster } from '../scripts/roster.mjs';
import { main as check } from '../scripts/check.mjs';
import { seatArgs, sessionFrom } from '../scripts/lib/members.mjs';

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

function council(seats, { chair = true } = {}) {
  mkdirSync(join(dir, 'home', 'c1'), { recursive: true });
  writeFileSync(join(dir, 'home', 'c1', 'council.json'), JSON.stringify({ seats }));
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
    STUB_LOG: join(dir, 'stub.jsonl'),
  });
});
afterEach(() => {
  process.chdir(prevCwd);
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
});

describe('members', () => {
  it('continues each member with its own flag and reads its id line', () => {
    expect(seatArgs({ member: 'agy', model: 'gemini-4-neon-high', session: 'c1' }, 'b.md')).toEqual(['--prompt-file', 'b.md', '--model', 'gemini-4-neon-high', '--conversation', 'c1']);
    expect(seatArgs({ member: 'grok', effort: 'low', session: 's1' }, 'b.md')).toEqual(['--prompt-file', 'b.md', '--effort', 'low', '--session', 's1']);
    expect(seatArgs({ member: 'opencode', effort: 'high' }, 'b.md')).toEqual(['--prompt-file', 'b.md']);
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

  it('refuses unknown seats and members before starting anything', async () => {
    council([{ name: 'g', member: 'grok' }]);
    expect((await capture(() => round(['--council', 'c1', '--brief', brief('q'), '--seats', 'nope']))).code).toBe(2);
    council([{ name: 'g', member: 'codex' }]);
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
    expect(r.stdout).toContain('| g | core | grok | the account default | low |');
  });
});
