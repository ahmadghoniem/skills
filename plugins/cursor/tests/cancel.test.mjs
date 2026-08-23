import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main as cancelMain } from '../scripts/cancel.mjs';
import { createJob, readJob, updateJob } from '../scripts/lib/jobs.mjs';
import { makeTempHome } from './helpers.mjs';

describe('/cursor:cancel', () => {
  let tmp;
  const prevHome = process.env.CCD_HOME;
  const prevCwd = process.cwd();
  let out;

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CCD_HOME = tmp.dir;
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
    if (prevHome === undefined) delete process.env.CCD_HOME;
    else process.env.CCD_HOME = prevHome;
    tmp.cleanup();
  });

  it('reaps a job whose pid names no live process and reports it as already gone', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    const pid = child.pid;
    await new Promise((resolve) => child.on('close', resolve));

    createJob({ id: 'deadpid1', repoPath: tmp.dir, prompt: 'p', model: 'composer-2.5' });
    updateJob(tmp.dir, 'deadpid1', { pid, cliPid: pid });

    const code = await cancelMain(['deadpid1']);
    expect(code).toBe(0);
    expect(out).toContain('process was already gone');
    expect(out).toContain(`pid ${pid}`);
    expect(out).not.toMatch(/^Job `deadpid1` marked as /);
    expect(readJob(tmp.dir, 'deadpid1')?.status).toBe('cancelled');
  });

  it('reports a job that was never running as already finished, not as a kill', async () => {
    createJob({ id: 'done1', repoPath: tmp.dir, prompt: 'p', model: 'composer-2.5' });
    updateJob(tmp.dir, 'done1', { status: 'done' });
    const code = await cancelMain(['done1']);
    expect(code).toBe(0);
    expect(out).toContain('was not running (already done)');
    expect(out).not.toContain('process was already gone');
  });

  it('exits 0 with a note when nothing is running', async () => {
    const code = await cancelMain([]);
    expect(code).toBe(0);
    expect(out).toContain('No running Cursor jobs to cancel.');
  });
});
