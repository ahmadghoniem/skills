import { spawn } from 'node:child_process';
import { existsSync, utimesSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cancelJob,
  createJob,
  findRunningJobs,
  jobDonePath,
  jobFilePath,
  listJobs,
  mostRecentFinishedJob,
  pruneOlderThanDays,
  readJob,
  updateJob,
} from '../scripts/lib/jobs.mjs';
import { makeTempHome } from './helpers.mjs';

describe('jobs registry', () => {
  let tmp;
  const prevHome = process.env.CCD_HOME;
  const repo = '/tmp/some-repo-path';

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CCD_HOME = tmp.dir;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CCD_HOME;
    else process.env.CCD_HOME = prevHome;
    tmp.cleanup();
  });

  it('creates, reads, and updates a job atomically', () => {
    const job = createJob({ id: 'job1', repoPath: repo, prompt: 'do it', model: 'composer-2.5' });
    expect(job.status).toBe('running');
    const read = readJob(repo, 'job1');
    expect(read?.prompt).toBe('do it');
    const updated = updateJob(repo, 'job1', {
      status: 'done',
      exitCode: 0,
      finishedAt: new Date().toISOString(),
    });
    expect(updated?.status).toBe('done');
  });

  it('lists jobs sorted newest first and filters by status', () => {
    createJob({ id: 'a', repoPath: repo, prompt: 'a', model: 'x' });
    createJob({ id: 'b', repoPath: repo, prompt: 'b', model: 'x' });
    updateJob(repo, 'a', { status: 'done', finishedAt: new Date().toISOString() });
    const all = listJobs(repo);
    expect(all.length).toBe(2);
    const running = listJobs(repo, { status: 'running' });
    expect(running.map((j) => j.id)).toEqual(['b']);
    expect(findRunningJobs(repo).map((j) => j.id)).toEqual(['b']);
    expect(mostRecentFinishedJob(repo)?.id).toBe('a');
  });

  it('prunes stale job files', () => {
    createJob({ id: 'old', repoPath: repo, prompt: 'old', model: 'x' });
    createJob({ id: 'new', repoPath: repo, prompt: 'new', model: 'x' });
    const stalePath = jobFilePath(repo, 'old');
    const past = new Date(Date.now() - 60 * 24 * 3600 * 1000);
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

  // Issue A: a caller's cwd (and therefore its computed repoPath) can drift
  // between the process that ran `delegate` and a later `status`/`result`
  // call — the id itself is the one thing guaranteed to be stable. readJob/
  // updateJob must find the job by id regardless of which repoPath guess the
  // caller passes in.
  it('readJob/updateJob find a job by id even when passed a different repoPath', () => {
    createJob({ id: 'drift1', repoPath: repo, prompt: 'p', model: 'm' });
    const otherGuess = '/tmp/some-other-cwd-guess';
    expect(readJob(otherGuess, 'drift1')?.id).toBe('drift1');
    const updated = updateJob(otherGuess, 'drift1', { status: 'done', summary: 'ok' });
    expect(updated?.status).toBe('done');
    // The update must land on the record's actual file, not create a stray
    // duplicate under the wrong (guessed) repoPath's job dir.
    expect(readJob(repo, 'drift1')?.summary).toBe('ok');
    expect(listJobs(otherGuess).length).toBe(0);
  });

  it('readJob returns null for a genuinely unknown id', () => {
    expect(readJob(repo, 'totally-unknown-id')).toBeNull();
  });

  // Issue C: a completion sentinel appears once the job reaches a terminal
  // status, and only then — a caller can watch/poll for the file's existence
  // instead of parsing the JSON record.
  it('updateJob writes a completion sentinel only on a terminal status', () => {
    createJob({ id: 'sentinel1', repoPath: repo, prompt: 'p', model: 'm' });
    expect(existsSync(jobDonePath(repo, 'sentinel1'))).toBe(false);
    updateJob(repo, 'sentinel1', { pid: 123 });
    expect(existsSync(jobDonePath(repo, 'sentinel1'))).toBe(false);
    updateJob(repo, 'sentinel1', { status: 'done', finishedAt: new Date().toISOString() });
    expect(existsSync(jobDonePath(repo, 'sentinel1'))).toBe(true);
  });
});
