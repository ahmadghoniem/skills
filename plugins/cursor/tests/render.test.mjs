import { describe, expect, it } from 'vitest';
import { renderOutcome, warnings } from '../scripts/lib/render.mjs';

const clean = {
  summary: 'Added src/foo.ts and updated README.md.\n',
  success: true,
  exitCode: 0,
  failedCommands: [],
};

describe('renderOutcome', () => {
  it('a clean run is cursor-agent’s write-up and nothing else', () => {
    expect(renderOutcome(clean)).toBe('Added src/foo.ts and updated README.md.\n');
  });

  it('never echoes the prompt back', () => {
    const out = renderOutcome({ ...clean, prompt: 'a five kilobyte brief' });
    expect(out).not.toContain('five kilobyte');
    expect(out).not.toMatch(/prompt/i);
  });

  it('never lists files touched — that list conflated reads with writes', () => {
    const out = renderOutcome({
      ...clean,
      filesTouched: ['src/foo.ts', 'docs/only-read-this-one.md'],
    });
    expect(out).not.toContain('only-read-this-one');
    expect(out).not.toMatch(/files touched/i);
  });

  it('stays quiet about the model when the run used the one that was asked for', () => {
    const out = renderOutcome({ ...clean, ranAs: undefined });
    expect(out).not.toMatch(/ran as/);
  });

  it('names the concrete model when `auto` resolved to something else', () => {
    const out = renderOutcome({ ...clean, ranAs: 'claude-4.6-sonnet-medium' });
    expect(out).toContain('⚠ ran as claude-4.6-sonnet-medium');
  });

  it('raises cursor-agent’s own verdict, with its exit reason when there is one', () => {
    expect(renderOutcome({ ...clean, success: false })).toContain(
      '⚠ cursor-agent did not report success',
    );
    expect(renderOutcome({ ...clean, success: false, exitReason: 'aborted' })).toContain(
      '⚠ cursor-agent did not report success (aborted)',
    );
  });

  it('raises a non-zero exit independently of that verdict', () => {
    const out = renderOutcome({ ...clean, exitCode: 1 });
    expect(out).toContain('⚠ exit 1');
    expect(out).not.toContain('did not report success');
  });

  it('does not collapse the CLI verdict and the exit code', () => {
    expect(warnings({ ...clean, success: false, exitCode: 2 })).toEqual([
      'cursor-agent did not report success',
      'exit 2',
    ]);
  });

  it('reports a watchdog kill', () => {
    expect(renderOutcome({ ...clean, killed: true })).toContain('⚠ run was killed before finishing');
  });

  it('reports failed commands without judging them', () => {
    const out = renderOutcome({
      ...clean,
      failedCommands: [
        { command: 'pnpm test', exitCode: 1, output: 'FAIL src/foo.test.ts', timedOut: false },
      ],
    });
    expect(out).toContain('⚠ 1 command exited non-zero');
    expect(out).toContain('reported, not judged');
    expect(out).toContain('pnpm test → exit 1');
    expect(out).toContain('FAIL src/foo.test.ts');
  });

  it('caps a noisy command output at ten lines', () => {
    const out = renderOutcome({
      ...clean,
      failedCommands: [
        {
          command: 'pnpm test',
          exitCode: 1,
          output: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'),
          timedOut: false,
        },
      ],
    });
    expect(out).toContain('line 9');
    expect(out).not.toContain('line 10');
  });

  it('says a killed job cannot be resumed rather than printing a dead chat line', () => {
    expect(renderOutcome({ ...clean, killed: true, chatLost: true })).toContain(
      'cannot be resumed',
    );
  });

  it('says so when cursor-agent returned nothing at all', () => {
    expect(renderOutcome({ ...clean, summary: '' })).toBe('(cursor-agent returned no write-up)\n');
  });
});

describe('warnings', () => {
  it('is empty for a clean run', () => {
    expect(warnings(clean)).toEqual([]);
  });
});
