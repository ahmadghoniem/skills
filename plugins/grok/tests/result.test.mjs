import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJob, updateJob } from '../scripts/lib/jobs.mjs';
import { main as resultMain } from '../scripts/result.mjs';
import { makeTempHome } from './helpers.mjs';

describe('/grok:result --list / --all', () => {
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(prevCwd);
    if (prevHome === undefined) delete process.env.CGD_HOME;
    else process.env.CGD_HOME = prevHome;
    tmp.cleanup();
  });

  function seedJobs(n, { status = 'done' } = {}) {
    const ids = [];
    for (let i = 0; i < n; i += 1) {
      const id = `j${String(i).padStart(2, '0')}`;
      ids.push(id);
      createJob({ id, repoPath: tmp.dir, prompt: `task ${i}`, model: 'grok-4.6' });
      updateJob(tmp.dir, id, {
        status,
        startedAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      });
    }
    return ids;
  }

  it('--all alone lists jobs instead of printing a single result', async () => {
    seedJobs(2);
    const code = await resultMain(['--all']);
    expect(code).toBe(0);
    expect(out).toContain('| ID | Status | Model | Age | Prompt |');
    expect(out).toContain('`j00`');
    expect(out).toContain('`j01`');
    expect(out).not.toContain('### Result of job');
  });

  it('--list still caps at 10', async () => {
    seedJobs(12);
    const code = await resultMain(['--list']);
    expect(code).toBe(0);
    const ids = [...out.matchAll(/`j\d{2}`/g)].map((m) => m[0]);
    expect(ids).toHaveLength(10);
    expect(out).not.toContain('`j00`');
    expect(out).toContain('`j11`');
    expect(out).toContain('`j02`');
  });

  it('--all returns every tracked job past the --list cap', async () => {
    seedJobs(12);
    await resultMain(['--all']);
    const ids = [...out.matchAll(/`j\d{2}`/g)].map((m) => m[0]);
    expect(ids).toHaveLength(12);
    expect(out).toContain('`j00`');
    expect(out).toContain('`j11`');
  });

  it('includes running jobs — the listing is the "which job was that?" recovery path', async () => {
    createJob({ id: 'running1', repoPath: tmp.dir, prompt: 'still going', model: 'grok-4.6' });
    await resultMain(['--list']);
    expect(out).toContain('`running1`');
    expect(out).toContain('running');
  });

  it('reports the empty state when nothing is tracked yet', async () => {
    const code = await resultMain(['--list']);
    expect(code).toBe(0);
    expect(out).toContain('No Grok jobs tracked for this repository yet.');
  });
});
