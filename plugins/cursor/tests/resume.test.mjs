// resume.mjs turns a job id, a uuid, or nothing into `--session <uuid>`.
// delegateMain is mocked so these exercise that logic without spawning cursor-agent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTempHome } from './helpers.mjs';

const delegateMain = vi.fn(async () => 0);
vi.mock('../scripts/delegate.mjs', () => ({
  main: (...args) => delegateMain(...args),
}));

const { createJob, updateJob } = await import('../scripts/lib/jobs.mjs');
const { main } = await import('../scripts/resume.mjs');

const prevHome = process.env.CCD_HOME;
const prevCwd = process.cwd();
const SID = '11111111-2222-3333-4444-555555555555';

let home;
let repo;

beforeEach(() => {
  home = makeTempHome();
  repo = makeTempHome();
  process.env.CCD_HOME = home.dir;
  process.chdir(repo.dir);
  delegateMain.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(prevCwd);
  if (prevHome === undefined) delete process.env.CCD_HOME;
  else process.env.CCD_HOME = prevHome;
  home.cleanup();
  repo.cleanup();
});

describe('resume.mjs', () => {
  it('turns a job id into its chat and drops the id from the follow-up', async () => {
    createJob({ id: 'my-job-aaaa', repoPath: repo.dir, prompt: 'p', model: '' });
    updateJob(repo.dir, 'my-job-aaaa', { chatId: SID });

    await main(['my-job-aaaa', 'follow-up', 'text', '--timeout', '60']);

    expect(delegateMain).toHaveBeenCalledWith(['--session', SID, 'follow-up', 'text', '--timeout', '60']);
  });

  it('passes a chat id straight through', async () => {
    await main([SID, '--prompt-file', 'C:/tmp/task.md']);
    expect(delegateMain).toHaveBeenCalledWith(['--session', SID, '--prompt-file', 'C:/tmp/task.md']);
  });

  it('picks the newest job in this repo that has a chat id when no id is given', async () => {
    createJob({ id: 'old-aaaa', repoPath: repo.dir, prompt: 'p', model: '' });
    updateJob(repo.dir, 'old-aaaa', { chatId: 'old-session', startedAt: '2026-01-01T00:00:00.000Z' });
    createJob({ id: 'none-aaaa', repoPath: repo.dir, prompt: 'p', model: '' });
    updateJob(repo.dir, 'none-aaaa', { startedAt: '2026-01-03T00:00:00.000Z' });
    createJob({ id: 'new-aaaa', repoPath: repo.dir, prompt: 'p', model: '' });
    updateJob(repo.dir, 'new-aaaa', { chatId: 'new-session', startedAt: '2026-01-02T00:00:00.000Z' });

    await main(['keep going']);

    expect(delegateMain).toHaveBeenCalledWith(['--session', 'new-session', 'keep going']);
  });

  it('returns 2 with a message when no job in this repo has a chat id', async () => {
    createJob({ id: 'none-only-aaaa', repoPath: repo.dir, prompt: 'p', model: '' });
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(await main(['keep going'])).toBe(2);
    expect(delegateMain).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith(expect.stringMatching(/No resumable Cursor job/));
  });

  it('leaves an explicit --session alone', async () => {
    await main(['--session', SID, 'more']);
    expect(delegateMain).toHaveBeenCalledWith(['--session', SID, 'more']);
  });
});
