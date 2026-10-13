// Integration tests for result.mjs's `main` on a running job: it reads agy's
// brain transcript (partial, since the job has not finished) and prints a
// progress line instead of "still running" alone.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transcriptPath } from '../scripts/lib/brain.mjs';
import { createJob, updateJob } from '../scripts/lib/jobs.mjs';

const prevHome = process.env.CAD_HOME;
const prevBrain = process.env.AGY_BRAIN_DIR;
const prevCwd = process.cwd();

let home;
let repo;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cad-result-'));
  repo = mkdtempSync(join(tmpdir(), 'cad-result-repo-'));
  process.env.CAD_HOME = home;
  process.env.AGY_BRAIN_DIR = join(home, 'brain');
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(prevCwd);
  if (prevHome === undefined) delete process.env.CAD_HOME;
  else process.env.CAD_HOME = prevHome;
  if (prevBrain === undefined) delete process.env.AGY_BRAIN_DIR;
  else process.env.AGY_BRAIN_DIR = prevBrain;
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

/** A running job whose brain transcript holds `text`. */
function runningJob(id, text) {
  createJob({ id, repoPath: repo, prompt: 'do the thing', model: '' });
  const conversationId = `conv-${id}`;
  updateJob(repo, id, { conversationId });
  if (text !== undefined) {
    const file = transcriptPath(conversationId);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, 'utf8');
  }
}

const turn = (name) => ({ source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', tool_calls: [{ name, args: {} }] });
const ok = { source: 'MODEL', type: 'GENERIC', status: 'DONE' };
const jsonl = (steps) => steps.map((s) => JSON.stringify(s)).join('\n') + '\n';

async function run(id) {
  const { main } = await import('../scripts/result.mjs');
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const code = await main([id]);
  const out = writeSpy.mock.calls.map((c) => c[0]).join('');
  writeSpy.mockRestore();
  return { code, out };
}

describe('result.mjs: a running job', () => {
  it('prints elapsed time, tool calls, the last tool, and tool failures so far', async () => {
    runningJob(
      'x-a7f3',
      jsonl([
        { source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE' },
        turn('view_file'),
        ok,
        turn('mcp_agy_bash'),
        { source: 'MODEL', type: 'GENERIC', status: 'INVALID', error: 'invalid arguments' },
        turn('write_file'),
      ]),
    );

    const { code, out } = await run('x-a7f3');

    expect(code).toBe(0);
    expect(out).toContain('still running');
    expect(out).toContain('3 tool calls');
    expect(out).toContain('last tool write_file');
    expect(out).toContain('1 tool failure so far (agy may retry)');
    expect(out).toContain('/agy:result x-a7f3');
  });

  it('does not throw before agy has written the transcript', async () => {
    runningJob('x-empty');

    const { code, out } = await run('x-empty');

    expect(code).toBe(0);
    expect(out).toContain('still running');
    expect(out).toContain('0 tool calls');
  });

  it('handles a torn last line in the transcript without throwing', async () => {
    runningJob('x-torn', `${JSON.stringify(turn('view_file'))}\n{"source":"MODEL","type":"PLANN`);

    const { code, out } = await run('x-torn');

    expect(code).toBe(0);
    expect(out).toContain('still running');
    expect(out).toContain('1 tool call');
  });
});
