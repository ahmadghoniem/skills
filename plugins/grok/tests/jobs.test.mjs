import { spawn } from 'node:child_process';
import { existsSync, utimesSync } from 'node:fs';
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
  updateJob,
} from '../scripts/lib/jobs.mjs';
import { jobsDir, repoHash } from '../scripts/lib/paths.mjs';
import { makeTempHome } from './helpers.mjs';

describe('jobs registry', () => {
  let tmp;
  const prevHome = process.env.CGD_HOME;
  const repo = '/tmp/some-repo-path';

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CGD_HOME = tmp.dir;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CGD_HOME;
    else process.env.CGD_HOME = prevHome;
    tmp.cleanup();
  });

  it('creates, reads, and updates a job atomically', () => {
    const job = createJob({ id: 'job1', repoPath: repo, prompt: 'do it', model: 'grok-4.6' });
    expect(job.status).toBe('running');
    const read = readJob(repo, 'job1');
    expect(read?.prompt).toBe('do it');
    const updated = updateJob(repo, 'job1', {
      status: 'done',
      exitCode: 0,
      finishedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(updated?.status).toBe('done');
    expect(readJob(repo, 'job1')?.exitCode).toBe(0);
  });

  it('round-trips cliPid on the job record', () => {
    createJob({ id: 'clipid1', repoPath: repo, prompt: 'p', model: 'm' });
    updateJob(repo, 'clipid1', { cliPid: 4242, pid: 111 });
    const read = readJob(repo, 'clipid1');
    expect(read?.cliPid).toBe(4242);
    expect(read?.pid).toBe(111);
  });

  it('lists jobs newest first, honours limit, and filters by status', () => {
    createJob({ id: 'a', repoPath: repo, prompt: 'a', model: 'x' });
    createJob({ id: 'b', repoPath: repo, prompt: 'b', model: 'x' });
    createJob({ id: 'c', repoPath: repo, prompt: 'c', model: 'x' });
    updateJob(repo, 'a', { startedAt: '2026-01-01T00:00:00.000Z', status: 'done' });
    updateJob(repo, 'b', { startedAt: '2026-01-02T00:00:00.000Z' });
    updateJob(repo, 'c', { startedAt: '2026-01-03T00:00:00.000Z', status: 'failed' });

    expect(listJobs(repo).map((j) => j.id)).toEqual(['c', 'b', 'a']);
    expect(listJobs(repo, { limit: 2 }).map((j) => j.id)).toEqual(['c', 'b']);
    expect(listJobs(repo, { status: 'running' }).map((j) => j.id)).toEqual(['b']);
    expect(findRunningJobs(repo).map((j) => j.id)).toEqual(['b']);
    expect(mostRecentFinishedJob(repo)?.id).toBe('c');
  });

  it('keys job files by the repo hash, not the raw path', () => {
    createJob({ id: 'h1', repoPath: repo, prompt: 'p', model: 'm' });
    const dir = jobsDir(repo);
    expect(dir).toContain(repoHash(repo));
    expect(dir.startsWith(tmp.dir)).toBe(true);
    expect(existsSync(jobFilePath(repo, 'h1'))).toBe(true);

    const other = '/tmp/a-different-repo';
    createJob({ id: 'h2', repoPath: other, prompt: 'p', model: 'm' });
    expect(repoHash(other)).not.toBe(repoHash(repo));
    expect(listJobs(repo).map((j) => j.id)).toEqual(['h1']);
    expect(listJobs(other).map((j) => j.id)).toEqual(['h2']);
  });

  it('prunes stale job files', () => {
    createJob({ id: 'old', repoPath: repo, prompt: 'old', model: 'x' });
    createJob({ id: 'new', repoPath: repo, prompt: 'new', model: 'x' });
    const stalePath = jobFilePath(repo, 'old');
    const past = new Date('2020-01-01T00:00:00.000Z');
    utimesSync(stalePath, past, past);
    const removed = pruneOlderThanDays(repo, 30);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(readJob(repo, 'old')).toBeNull();
    expect(readJob(repo, 'new')).not.toBeNull();
  });

  it('cancelJob SIGTERMs a live pid and marks cancelled', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      detached: false,
    });
    try {
      await new Promise((r) => setTimeout(r, 50));
      createJob({ id: 'live', repoPath: repo, prompt: 'p', model: 'm' });
      updateJob(repo, 'live', { pid: child.pid });
      const cancelled = await cancelJob(repo, 'live', 500);
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
    createJob({ id: 'done1', repoPath: repo, prompt: 'p', model: 'm' });
    updateJob(repo, 'done1', { status: 'done' });
    const res = await cancelJob(repo, 'done1');
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
    createJob({ id: 'drift1', repoPath: repo, prompt: 'p', model: 'm' });
    const otherGuess = '/tmp/some-other-cwd-guess';
    expect(readJob(otherGuess, 'drift1')?.id).toBe('drift1');
    const updated = updateJob(otherGuess, 'drift1', { status: 'done', summary: 'ok' });
    expect(updated?.status).toBe('done');
    expect(readJob(repo, 'drift1')?.summary).toBe('ok');
    expect(listJobs(otherGuess).length).toBe(0);
  });

  it('readJob returns null for a genuinely unknown id', () => {
    expect(readJob(repo, 'totally-unknown-id')).toBeNull();
  });

  it('updateJob writes a completion sentinel only on a terminal status', () => {
    createJob({ id: 'sentinel1', repoPath: repo, prompt: 'p', model: 'm' });
    expect(existsSync(jobDonePath(repo, 'sentinel1'))).toBe(false);
    updateJob(repo, 'sentinel1', { pid: 123 });
    expect(existsSync(jobDonePath(repo, 'sentinel1'))).toBe(false);
    updateJob(repo, 'sentinel1', { status: 'done', finishedAt: '2026-01-01T00:00:00.000Z' });
    expect(existsSync(jobDonePath(repo, 'sentinel1'))).toBe(true);
  });
});
