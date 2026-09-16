// Tests for resume.mjs's flag pass-through (F2) and no-id resolution (F3).
// delegateMain is mocked so these exercise resume.mjs's own logic without
// spawning agy.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const delegateMain = vi.fn(async () => 0);
vi.mock('../scripts/delegate.mjs', () => ({
  main: (...args) => delegateMain(...args),
}));

const { createJob, updateJob } = await import('../scripts/lib/jobs.mjs');
const { main } = await import('../scripts/resume.mjs');

const prevHome = process.env.CAD_HOME;
const prevCwd = process.cwd();

let home;
let repo;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cad-resume-'));
  repo = mkdtempSync(join(tmpdir(), 'cad-resume-repo-'));
  process.env.CAD_HOME = home;
  process.chdir(repo);
  delegateMain.mockClear();
});

afterEach(() => {
  process.chdir(prevCwd);
  if (prevHome === undefined) delete process.env.CAD_HOME;
  else process.env.CAD_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('resume.mjs: flag pass-through (F2)', () => {
  it('passes an arbitrary flag through to delegateMain and strips the job token', async () => {
    createJob({ id: 'my-job-aaaa', repoPath: repo, prompt: 'p', model: 'm' });
    updateJob(repo, 'my-job-aaaa', { conversationId: 'conv-1' });

    await main(['my-job-aaaa', '--foo', 'bar']);

    expect(delegateMain).toHaveBeenCalledTimes(1);
    expect(delegateMain).toHaveBeenCalledWith(['--conversation', 'conv-1', '--foo', 'bar']);
  });

  it('does not duplicate a flag (kebab and camelCase both appear in flags, but tokens stay one)', async () => {
    createJob({ id: 'my-job2-aaaa', repoPath: repo, prompt: 'p', model: 'm' });
    updateJob(repo, 'my-job2-aaaa', { conversationId: 'conv-2' });

    await main(['my-job2-aaaa', '--prompt-file', 'x']);

    const tokens = delegateMain.mock.calls[0][0];
    expect(tokens.filter((t) => t === '--prompt-file').length).toBe(1);
    expect(tokens).toEqual(['--conversation', 'conv-2', '--prompt-file', 'x']);
  });

  it('removes the job token from the passed-through tokens', async () => {
    createJob({ id: 'my-job3-aaaa', repoPath: repo, prompt: 'p', model: 'm' });
    updateJob(repo, 'my-job3-aaaa', { conversationId: 'conv-3' });

    await main(['my-job3-aaaa', 'follow-up', 'text']);

    const tokens = delegateMain.mock.calls[0][0];
    expect(tokens).not.toContain('my-job3-aaaa');
    expect(tokens).toEqual(['--conversation', 'conv-3', 'follow-up', 'text']);
  });

  it('keeps a --prompt-file value intact through a UUID resume', async () => {
    const uuid = '11111111-2222-3333-4444-555555555555';

    await main([uuid, '--prompt-file', 'C:/tmp/task.md']);

    expect(delegateMain).toHaveBeenCalledWith([
      '--conversation',
      uuid,
      '--prompt-file',
      'C:/tmp/task.md',
    ]);
  });
});

describe('resume.mjs: no-id resolution (F3)', () => {
  it('picks the newest job in this repo that has a conversation id', async () => {
    createJob({ id: 'old-job-aaaa', repoPath: repo, prompt: 'p', model: 'm' });
    updateJob(repo, 'old-job-aaaa', {
      conversationId: 'conv-old',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    createJob({ id: 'no-conv-job-aaaa', repoPath: repo, prompt: 'p', model: 'm' });
    updateJob(repo, 'no-conv-job-aaaa', { startedAt: '2026-01-03T00:00:00.000Z' });
    createJob({ id: 'new-job-aaaa', repoPath: repo, prompt: 'p', model: 'm' });
    updateJob(repo, 'new-job-aaaa', {
      conversationId: 'conv-new',
      startedAt: '2026-01-02T00:00:00.000Z',
    });

    await main(['follow-up prompt']);

    expect(delegateMain).toHaveBeenCalledWith(['--conversation', 'conv-new', 'follow-up prompt']);
  });

  it('returns 2 and writes a message to stderr when no job in this repo has a conversation id', async () => {
    createJob({ id: 'no-conv-only-aaaa', repoPath: repo, prompt: 'p', model: 'm' });
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await main(['follow-up prompt']);

    expect(code).toBe(2);
    expect(delegateMain).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith(expect.stringMatching(/No resumable agy job/));
    writeSpy.mockRestore();
  });

  it('still passes an explicit --continue straight through, unmodified', async () => {
    await main(['--continue', 'follow-up']);

    expect(delegateMain).toHaveBeenCalledWith(['--continue', 'follow-up']);
  });
});
