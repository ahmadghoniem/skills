import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main as cancelMain } from '../scripts/cancel.mjs';
import { createJob, readJob, updateJob } from '../scripts/lib/jobs.mjs';
import { makeTempHome } from './helpers.mjs';

describe('/grok:cancel', () => {
  let tmp;
  const prevHome = process.env.CGD_HOME;
  const prevCwd = process.cwd();
  let out;
  let err;

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CGD_HOME = tmp.dir;
    process.chdir(tmp.dir);
    out = '';
    err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out += s;
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
      err += s;
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(prevCwd);
    if (prevHome === undefined) delete process.env.CGD_HOME;
    else process.env.CGD_HOME = prevHome;
    tmp.cleanup();
  });

  it('reaps a job whose pid names no live process and reports it as already gone', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    const pid = child.pid;
    await new Promise((resolve) => child.on('close', resolve));

    createJob({ id: 'deadpid1', repoPath: tmp.dir, prompt: 'p', model: 'grok-4.6' });
    updateJob(tmp.dir, 'deadpid1', { pid });

    const code = await cancelMain(['deadpid1']);
    expect(code).toBe(0);
    expect(out).toContain('process was already gone');
    expect(out).toContain(`pid ${pid}`);
    // The live-kill path is `Job \`id\` marked as cancelled.` — a dead pid must
    // not be reported that way.
    expect(out).not.toMatch(/^Job `deadpid1` marked as /);
    expect(readJob(tmp.dir, 'deadpid1')?.status).toBe('cancelled');
  });

  it('reports a job that was never running as already finished, not as a kill', async () => {
    createJob({ id: 'done1', repoPath: tmp.dir, prompt: 'p', model: 'grok-4.6' });
    updateJob(tmp.dir, 'done1', { status: 'done' });
    const code = await cancelMain(['done1']);
    expect(code).toBe(0);
    expect(out).toContain('was not running (already done)');
    expect(out).not.toContain('process was already gone');
  });

  it('exits 0 with a note when nothing is running', async () => {
    const code = await cancelMain([]);
    expect(code).toBe(0);
    expect(out).toContain('No running Grok jobs to cancel.');
  });
});
