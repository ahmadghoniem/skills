import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJob, rawLogPath, updateJob } from '../scripts/lib/jobs.mjs';
import { main as resultMain } from '../scripts/result.mjs';
import { makeTempHome } from './helpers.mjs';

describe('/grok:result', () => {
  let tmp;
  const prevHome = process.env.CGD_HOME;
  const prevCwd = process.cwd();
  let out;

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CGD_HOME = tmp.dir;
    process.chdir(tmp.dir);
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out += s;
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(prevCwd);
    if (prevHome === undefined) delete process.env.CGD_HOME;
    else process.env.CGD_HOME = prevHome;
    tmp.cleanup();
  });

  function seedJobs(n, { status = 'done' } = {}) {
    for (let i = 0; i < n; i += 1) {
      const id = `j${String(i).padStart(2, '0')}`;
      createJob({ id, repoPath: tmp.dir, prompt: `task ${i}`, model: '' });
      updateJob(tmp.dir, id, {
        status,
        startedAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      });
    }
  }

  const listed = () => [...out.matchAll(/^j\d{2}\b/gm)].map((m) => m[0]);

  it('--all lists jobs instead of printing a single result', async () => {
    seedJobs(2);
    expect(await resultMain(['--all'])).toBe(0);
    expect(out).toContain('id  status  started');
    expect(listed()).toEqual(['j01', 'j00']);
  });

  it('--list caps at 10, newest first', async () => {
    seedJobs(12);
    await resultMain(['--list']);
    expect(listed()).toHaveLength(10);
    expect(listed()[0]).toBe('j11');
    expect(listed()).not.toContain('j00');
  });

  it('--all returns every tracked job past the --list cap', async () => {
    seedJobs(12);
    await resultMain(['--all']);
    expect(listed()).toHaveLength(12);
  });

  it('reports the empty state when nothing is tracked yet', async () => {
    expect(await resultMain(['--list'])).toBe(0);
    expect(out).toContain('No grok jobs tracked for this repository yet.');
  });

  it('prints the newest finished job when no id is given', async () => {
    createJob({ id: 'older', repoPath: tmp.dir, prompt: 'a', model: '' });
    updateJob(tmp.dir, 'older', { status: 'done', summary: 'first write-up', finishedAt: '2026-01-01T00:00:00.000Z' });
    createJob({ id: 'newer', repoPath: tmp.dir, prompt: 'b', model: '' });
    updateJob(tmp.dir, 'newer', { status: 'done', summary: 'second write-up', finishedAt: '2026-01-02T00:00:00.000Z' });
    await resultMain([]);
    expect(out).toBe('second write-up\n');
  });

  it('shows progress for a running job, counted from its event log', async () => {
    createJob({ id: 'busy', repoPath: tmp.dir, prompt: 'p', model: '' });
    updateJob(tmp.dir, 'busy', { pid: process.pid });
    writeFileSync(
      rawLogPath(tmp.dir, 'busy'),
      [
        '{"type":"tool_call","toolName":"read_file"}',
        '{"type":"text","data":"x"}',
        '{"type":"tool_call","toolName":"search_replace"}',
        '',
      ].join('\n'),
      'utf8',
    );
    expect(await resultMain(['busy'])).toBe(0);
    expect(out).toContain('is still running');
    expect(out).toContain('2 tool calls, last tool search_replace');
  });

  it('offers a resume for a failed job that kept its session id', async () => {
    createJob({ id: 'cut-short', repoPath: tmp.dir, prompt: 'big one', model: '' });
    updateJob(tmp.dir, 'cut-short', {
      status: 'failed',
      summary: 'partial work',
      grokSessionId: '11111111-2222-3333-4444-555555555555',
    });
    await resultMain(['cut-short']);
    expect(out).toContain('/grok:resume cut-short');
  });

  it('offers no resume for a job that finished', async () => {
    createJob({ id: 'finished', repoPath: tmp.dir, prompt: 'small one', model: '' });
    updateJob(tmp.dir, 'finished', {
      status: 'done',
      summary: 'all good',
      stopReason: 'end_turn',
      exitCode: 0,
      grokSessionId: '11111111-2222-3333-4444-555555555555',
    });
    await resultMain(['finished']);
    expect(out).toBe('all good\n');
  });
});
