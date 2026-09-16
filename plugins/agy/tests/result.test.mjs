// Integration tests for result.mjs's `main` on a running job: it reads the
// job's raw NDJSON log (partial, since the job has not finished) and prints a
// progress line instead of "still running" alone.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJob, rawLogPath } from '../scripts/lib/jobs.mjs';

const prevHome = process.env.CAD_HOME;
const prevCwd = process.cwd();

let home;
let repo;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cad-result-'));
  repo = mkdtempSync(join(tmpdir(), 'cad-result-repo-'));
  process.env.CAD_HOME = home;
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(prevCwd);
  if (prevHome === undefined) delete process.env.CAD_HOME;
  else process.env.CAD_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

function ndjson(events) {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

describe('result.mjs: a running job', () => {
  it('prints elapsed time, tool calls, the last tool, and tool failures so far', async () => {
    const { main } = await import('../scripts/result.mjs');
    const job = createJob({ id: 'x-a7f3', repoPath: repo, prompt: 'do the thing', model: '' });

    writeFileSync(
      rawLogPath(repo, job.id),
      ndjson([
        { event: 'step_update', step_update: { step_type: 'tool', tool_name: 'view_file' } },
        {
          event: 'step_update',
          step_update: { step_type: 'tool', tool_name: 'run_command', state: 'ERROR', tool_info: { error: { message: 'timed out' } } },
        },
        { event: 'step_update', step_update: { step_type: 'tool', tool_name: 'write_file' } },
      ]),
      'utf8',
    );

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await main(['x-a7f3']);
    const out = writeSpy.mock.calls.map((c) => c[0]).join('');
    writeSpy.mockRestore();

    expect(code).toBe(0);
    expect(out).toContain('still running');
    expect(out).toContain('3 tool calls');
    expect(out).toContain('last tool write_file');
    expect(out).toContain('1 tool failure so far (agy may retry)');
    expect(out).toContain('/agy:result x-a7f3');
  });

  it('does not throw when the log is missing or empty', async () => {
    const { main } = await import('../scripts/result.mjs');
    createJob({ id: 'x-empty', repoPath: repo, prompt: 'do the thing', model: '' });
    // No log file written at all: rawLogPath does not exist yet.

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await main(['x-empty']);
    const out = writeSpy.mock.calls.map((c) => c[0]).join('');
    writeSpy.mockRestore();

    expect(code).toBe(0);
    expect(out).toContain('still running');
    expect(out).toContain('0 tool calls');
  });

  it('handles a torn last line in the log without throwing', async () => {
    const { main } = await import('../scripts/result.mjs');
    const job = createJob({ id: 'x-torn', repoPath: repo, prompt: 'do the thing', model: '' });
    const complete = JSON.stringify({
      event: 'step_update',
      step_update: { step_type: 'tool', tool_name: 'view_file' },
    });
    // A write in progress: the last line is cut off mid-JSON.
    writeFileSync(rawLogPath(repo, job.id), `${complete}\n{"event":"step_update","step_up`, 'utf8');

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await main(['x-torn']);
    const out = writeSpy.mock.calls.map((c) => c[0]).join('');
    writeSpy.mockRestore();

    expect(code).toBe(0);
    expect(out).toContain('still running');
    expect(out).toContain('1 tool call');
  });
});
