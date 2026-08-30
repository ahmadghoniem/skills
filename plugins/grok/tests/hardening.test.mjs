import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseArgv, parseTimeout, splitArgString } from '../scripts/lib/args.mjs';
import { id } from '../scripts/lib/id.mjs';
import { createJob, jobFilePath, listJobs, readJob, updateJob } from '../scripts/lib/jobs.mjs';
import { mdCell } from '../scripts/lib/md.mjs';
import { repoHash } from '../scripts/lib/paths.mjs';
import { makeTempHome } from './helpers.mjs';

describe('args hardening', () => {
  it('still negates the bare --no-foo form', () => {
    const { flags } = parseArgv(['--no-color']);
    expect(flags['color']).toBe(false);
  });

  it('casts a safe integer in --foo=value form', () => {
    const { flags } = parseArgv(['--n=123']);
    expect(flags['n']).toBe(123);
  });

  it('does not cast a large id in --foo=value form', () => {
    const { flags } = parseArgv(['--id=12345678901234567890']);
    expect(flags['id']).toBe('12345678901234567890');
  });

  it('parseTimeout default matches the function-level fallback of 1800', () => {
    expect(parseTimeout('abc')).toBe(1800);
    expect(parseTimeout(-0.5)).toBe(1800);
  });

  it('splitArgString keeps mixed quoted tokens in order', () => {
    expect(splitArgString(`--model 'grok-4.6' "fix the parser"`)).toEqual([
      '--model',
      'grok-4.6',
      'fix the parser',
    ]);
  });
});

describe('id hardening', () => {
  it('produces exactly the requested length with no padding bias', () => {
    for (const len of [10, 16, 24]) {
      const ids = Array.from({ length: 200 }, () => id(len));
      for (const x of ids) {
        expect(x.length).toBe(len);
        expect(/^[A-Za-z0-9_-]+$/.test(x)).toBe(true);
      }
      const lastChars = new Set(ids.map((x) => x[len - 1]));
      expect(lastChars.size).toBeGreaterThan(1);
    }
  });
});

describe('paths hardening', () => {
  it('repoHash is stable and does not throw for a non-existent path', () => {
    const p = '/definitely/not/a/real/path/xyz';
    const a = repoHash(p);
    const b = repoHash(p);
    expect(a).toBe(b);
    expect(/^[0-9a-f]{12}$/.test(a)).toBe(true);
  });
});

describe('md hardening', () => {
  it('escapes pipes and collapses whitespace', () => {
    expect(mdCell('a|b')).toBe('a\\|b');
    expect(mdCell('x\n  y')).toBe('x y');
    expect(mdCell(undefined)).toBe('');
    expect(mdCell(42)).toBe('42');
  });
});

describe('jobs hardening', () => {
  let tmp;
  const prevHome = process.env.CGD_HOME;

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CGD_HOME = tmp.dir;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.CGD_HOME;
    else process.env.CGD_HOME = prevHome;
    tmp.cleanup();
  });

  it('does not resurrect a cancelled job to done', () => {
    createJob({ id: 'job1', repoPath: tmp.dir, prompt: 'x', model: 'grok-4.6' });
    updateJob(tmp.dir, 'job1', { status: 'cancelled' });
    updateJob(tmp.dir, 'job1', { status: 'done', exitCode: 0 });
    const job = readJob(tmp.dir, 'job1');
    expect(job.status).toBe('cancelled');
    expect(job.exitCode).toBe(0);
  });

  it('listJobs tolerates a job record missing prompt', () => {
    createJob({ id: 'job2', repoPath: tmp.dir, prompt: 'ok', model: 'grok-4.6' });
    writeFileSync(
      jobFilePath(tmp.dir, 'job3'),
      JSON.stringify({ id: 'job3', status: 'done', startedAt: new Date(0).toISOString() }),
      'utf8',
    );
    const jobs = listJobs(tmp.dir);
    expect(jobs.length).toBe(2);
  });
});
