import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repoRoot } from '../scripts/lib/git.mjs';
import { createJob, updateJob } from '../scripts/lib/jobs.mjs';
import { age, renderJobTable } from '../scripts/lib/jobtable.mjs';
import { main as resultMain } from '../scripts/result.mjs';
import { makeTempHome } from './helpers.mjs';

describe('renderJobTable', () => {
  it('reports the empty state instead of an empty table', () => {
    expect(renderJobTable([])).toBe('No Cursor jobs tracked for this repository yet.\n');
  });

  it('renders one row per job with the id in a code span', () => {
    const out = renderJobTable([
      { id: 'abc123', status: 'done', model: 'composer-2.5-fast', startedAt: new Date().toISOString(), prompt: 'add retries' },
    ]);
    expect(out).toContain('| ID | Status | Model | Age | Prompt |');
    expect(out).toContain('`abc123`');
    expect(out).toContain('composer-2.5-fast');
    expect(out).toContain('add retries');
  });

  it('truncates a long prompt so the table stays one line per job', () => {
    const out = renderJobTable([
      { id: 'x', status: 'done', model: 'm', startedAt: new Date().toISOString(), prompt: 'p'.repeat(200) },
    ]);
    expect(out).toContain('…');
    expect(out.split('\n')[2].length).toBeLessThan(140);
  });

  it('never lets a pipe in the prompt break the table', () => {
    const out = renderJobTable([
      { id: 'x', status: 'done', model: 'm', startedAt: new Date().toISOString(), prompt: 'a | b' },
    ]);
    // mdCell escapes the pipe so it renders as text instead of opening a column.
    expect(out).toContain('a \\| b');
  });

  it('degrades to ? for an unparseable timestamp rather than NaN', () => {
    expect(age('not-a-date')).toBe('?');
  });
});

describe('/cursor:result --list', () => {
  let tmp;
  const prevHome = process.env.CCD_HOME;
  let out;
  // result.mjs keys the registry by git repo root, not cwd — the fixture must
  // use the same key or the listing comes back empty.
  let root;

  beforeEach(async () => {
    tmp = makeTempHome();
    process.env.CCD_HOME = tmp.dir;
    root = await repoRoot(process.cwd());
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out += s;
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevHome === undefined) delete process.env.CCD_HOME;
    else process.env.CCD_HOME = prevHome;
    tmp.cleanup();
  });

  it('lists tracked jobs instead of printing a single result', async () => {
    createJob({ id: 'j1', repoPath: root, prompt: 'first task', model: 'composer-2.5' });
    updateJob(root, 'j1', { status: 'done', exitCode: 0, finishedAt: new Date().toISOString() });
    const code = await resultMain(['--list']);
    expect(code).toBe(0);
    expect(out).toContain('| ID | Status | Model | Age | Prompt |');
    expect(out).toContain('`j1`');
  });

  it('includes running jobs — the listing is the "which job was that?" recovery path', async () => {
    createJob({ id: 'running1', repoPath: root, prompt: 'still going', model: 'composer-2.5' });
    await resultMain(['--list']);
    expect(out).toContain('`running1`');
    expect(out).toContain('running');
  });

  it('reports the empty state when nothing is tracked yet', async () => {
    const code = await resultMain(['--list']);
    expect(code).toBe(0);
    expect(out).toContain('No Cursor jobs tracked for this repository yet.');
  });
});
