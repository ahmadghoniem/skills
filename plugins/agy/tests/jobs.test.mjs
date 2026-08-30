import { existsSync, utimesSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cancelJob,
  createJob,
  findRunningJobs,
  isPidGone,
  jobDonePath,
  jobFilePath,
  listJobs,
  mostRecentFinishedJob,
  pruneOlderThanDays,
  readJob,
  resolveJob,
  uniqueJobName,
  updateJob,
} from '../scripts/lib/jobs.mjs';
import { jobsDir, repoHash } from '../scripts/lib/paths.mjs';
import { makeTempHome } from './helpers.mjs';

describe('jobs registry', () => {
  let tmp;
  const prevHome = process.env.CAD_HOME;
  const repo = '/tmp/some-repo-path';

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CAD_HOME = tmp.dir;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CAD_HOME;
    else process.env.CAD_HOME = prevHome;
    tmp.cleanup();
  });

  it('creates, reads, and updates a job atomically', () => {
    const job = createJob({
      id: 'add-retry-to-fetchuser-a7f3',
      repoPath: repo,
      prompt: 'do it',
      model: 'gemini-3.7-flash-low',
    });
    expect(job.status).toBe('running');
    expect(job.promptPath).toContain('add-retry-to-fetchuser-a7f3.prompt.md');
    expect(job.agyLogPath).toContain('add-retry-to-fetchuser-a7f3.agy.log');
    const read = readJob(repo, 'add-retry-to-fetchuser-a7f3');
    expect(read?.prompt).toBe('do it');
    const updated = updateJob(repo, 'add-retry-to-fetchuser-a7f3', {
      status: 'done',
      exitCode: 0,
      agyStatus: 'SUCCESS',
      finishedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(updated?.status).toBe('done');
    expect(readJob(repo, 'add-retry-to-fetchuser-a7f3')?.exitCode).toBe(0);
  });

  it('resolves by full name, unique prefix, or 4-char suffix', () => {
    createJob({ id: 'add-retry-to-fetchuser-a7f3', repoPath: repo, prompt: 'p', model: 'm' });
    createJob({ id: 'fix-the-parser-b2c1', repoPath: repo, prompt: 'p', model: 'm' });

    expect(resolveJob(repo, 'add-retry-to-fetchuser-a7f3').job?.id).toBe(
      'add-retry-to-fetchuser-a7f3',
    );
    expect(resolveJob(repo, 'add-retry').job?.id).toBe('add-retry-to-fetchuser-a7f3');
    expect(resolveJob(repo, 'a7f3').job?.id).toBe('add-retry-to-fetchuser-a7f3');
    expect(resolveJob(repo, 'b2c1').job?.id).toBe('fix-the-parser-b2c1');
    expect(resolveJob(repo, 'nope').job).toBeNull();
  });

  it('errors on an ambiguous prefix or suffix', () => {
    createJob({ id: 'add-retry-aaaa', repoPath: repo, prompt: 'p', model: 'm' });
    createJob({ id: 'add-retry-bbbb', repoPath: repo, prompt: 'p', model: 'm' });
    const prefix = resolveJob(repo, 'add-retry');
    expect(prefix.job).toBeNull();
    expect(prefix.error).toMatch(/Ambiguous job id/);

    createJob({ id: 'one-task-zzzz', repoPath: repo, prompt: 'p', model: 'm' });
    createJob({ id: 'two-task-zzzz', repoPath: repo, prompt: 'p', model: 'm' });
    const suffix = resolveJob(repo, 'zzzz');
    expect(suffix.job).toBeNull();
    expect(suffix.error).toMatch(/Ambiguous job suffix/);
  });

  it('uniqueJobName produces a kebab slug plus a 4-char suffix', () => {
    const name = uniqueJobName(repo, 'Add retry to FetchUser');
    expect(name).toMatch(/^add-retry-to-fetchuser-[a-z0-9]{4}$/);
  });

  it('round-trips cliPid on the job record', () => {
    createJob({ id: 'clipid1-a7f3', repoPath: repo, prompt: 'p', model: 'm' });
    updateJob(repo, 'clipid1-a7f3', { cliPid: 4242, pid: 111 });
    const read = readJob(repo, 'clipid1-a7f3');
    expect(read?.cliPid).toBe(4242);
    expect(read?.pid).toBe(111);
  });

  it('lists jobs newest first, honours limit, and filters by status', () => {
    createJob({ id: 'a-aaaa', repoPath: repo, prompt: 'a', model: 'x' });
    createJob({ id: 'b-bbbb', repoPath: repo, prompt: 'b', model: 'x' });
    createJob({ id: 'c-cccc', repoPath: repo, prompt: 'c', model: 'x' });
    updateJob(repo, 'a-aaaa', { startedAt: '2026-01-01T00:00:00.000Z', status: 'done' });
    updateJob(repo, 'b-bbbb', { startedAt: '2026-01-02T00:00:00.000Z' });
    updateJob(repo, 'c-cccc', { startedAt: '2026-01-03T00:00:00.000Z', status: 'failed' });

    expect(listJobs(repo).map((j) => j.id)).toEqual(['c-cccc', 'b-bbbb', 'a-aaaa']);
    expect(listJobs(repo, { limit: 2 }).map((j) => j.id)).toEqual(['c-cccc', 'b-bbbb']);
    expect(listJobs(repo, { status: 'running' }).map((j) => j.id)).toEqual(['b-bbbb']);
    expect(findRunningJobs(repo).map((j) => j.id)).toEqual(['b-bbbb']);
    expect(mostRecentFinishedJob(repo)?.id).toBe('c-cccc');
  });

  it('keys job files by the repo hash, not the raw path', () => {
    createJob({ id: 'h1-aaaa', repoPath: repo, prompt: 'p', model: 'm' });
    const dir = jobsDir(repo);
    expect(dir).toContain(repoHash(repo));
    expect(dir.startsWith(tmp.dir)).toBe(true);
    expect(existsSync(jobFilePath(repo, 'h1-aaaa'))).toBe(true);

    const other = '/tmp/a-different-repo';
    createJob({ id: 'h2-bbbb', repoPath: other, prompt: 'p', model: 'm' });
    expect(repoHash(other)).not.toBe(repoHash(repo));
    expect(listJobs(repo).map((j) => j.id)).toEqual(['h1-aaaa']);
    expect(listJobs(other).map((j) => j.id)).toEqual(['h2-bbbb']);
  });

  it('prunes stale job files', () => {
    createJob({ id: 'old-aaaa', repoPath: repo, prompt: 'old', model: 'x' });
    createJob({ id: 'new-bbbb', repoPath: repo, prompt: 'new', model: 'x' });
    const stalePath = jobFilePath(repo, 'old-aaaa');
    const past = new Date('2020-01-01T00:00:00.000Z');
    utimesSync(stalePath, past, past);
    const removed = pruneOlderThanDays(repo, 30);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(readJob(repo, 'old-aaaa')).toBeNull();
    expect(readJob(repo, 'new-bbbb')).not.toBeNull();
  });

  it('cancelJob SIGTERMs a live pid and marks cancelled', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      detached: false,
    });
    try {
      await new Promise((r) => setTimeout(r, 50));
      createJob({ id: 'live-aaaa', repoPath: repo, prompt: 'p', model: 'm' });
      updateJob(repo, 'live-aaaa', { pid: child.pid });
      const cancelled = await cancelJob(repo, 'live-aaaa', 500);
      expect(cancelled?.status).toBe('cancelled');
    } finally {
      if (!child.killed) child.kill('SIGKILL');
    }
  });

  it('cancelJob on unknown id returns null', async () => {
    const res = await cancelJob(repo, 'nope');
    expect(res).toBeNull();
  });

  it('cancelJob on already-finished job returns unchanged record', async () => {
    createJob({ id: 'done1-aaaa', repoPath: repo, prompt: 'p', model: 'm' });
    updateJob(repo, 'done1-aaaa', { status: 'done' });
    const res = await cancelJob(repo, 'done1-aaaa');
    expect(res?.status).toBe('done');
  });

  it('isPidGone is true for a process that has already exited', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    const pid = child.pid;
    await new Promise((resolve) => child.on('close', resolve));
    expect(typeof pid).toBe('number');
    expect(isPidGone(pid)).toBe(true);
    expect(isPidGone(process.pid)).toBe(false);
  });

  it('readJob/updateJob find a job by id even when passed a different repoPath', () => {
    createJob({ id: 'drift1-aaaa', repoPath: repo, prompt: 'p', model: 'm' });
    const otherGuess = '/tmp/some-other-cwd-guess';
    expect(readJob(otherGuess, 'drift1-aaaa')?.id).toBe('drift1-aaaa');
    const updated = updateJob(otherGuess, 'drift1-aaaa', { status: 'done', summary: 'ok' });
    expect(updated?.status).toBe('done');
    expect(readJob(repo, 'drift1-aaaa')?.summary).toBe('ok');
    expect(listJobs(otherGuess).length).toBe(0);
  });

  it('readJob returns null for a genuinely unknown id', () => {
    expect(readJob(repo, 'totally-unknown-id')).toBeNull();
  });

  it('updateJob writes a completion sentinel only on a terminal status', () => {
    createJob({ id: 'sentinel1-aaaa', repoPath: repo, prompt: 'p', model: 'm' });
    expect(existsSync(jobDonePath(repo, 'sentinel1-aaaa'))).toBe(false);
    updateJob(repo, 'sentinel1-aaaa', { pid: 123 });
    expect(existsSync(jobDonePath(repo, 'sentinel1-aaaa'))).toBe(false);
    updateJob(repo, 'sentinel1-aaaa', { status: 'done', finishedAt: '2026-01-01T00:00:00.000Z' });
    expect(existsSync(jobDonePath(repo, 'sentinel1-aaaa'))).toBe(true);
  });
});
