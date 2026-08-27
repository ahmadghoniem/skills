import { describe, expect, it } from 'vitest';
import { renderOutcome, warnings } from '../scripts/lib/render.mjs';

const clean = {
  summary: 'Added retry-on-429 to src/api/client.ts and a covering test.\n',
  stopReason: 'end_turn',
  exitCode: 0,
  failedCommands: [],
};

describe('renderOutcome', () => {
  it('a clean run is grok’s write-up and nothing else', () => {
    expect(renderOutcome(clean)).toBe(
      'Added retry-on-429 to src/api/client.ts and a covering test.\n',
    );
  });

  it('never echoes the prompt back', () => {
    const out = renderOutcome({ ...clean, prompt: 'a five kilobyte brief' });
    expect(out).not.toContain('five kilobyte');
    expect(out).not.toMatch(/prompt/i);
  });

  it('never lists files touched — that list conflated reads with writes', () => {
    const out = renderOutcome({
      ...clean,
      filesTouched: ['src/api/client.ts', 'docs/only-read-this-one.md'],
    });
    expect(out).not.toContain('only-read-this-one');
    expect(out).not.toMatch(/files touched/i);
  });

  // The case this was written for: a run refused for a bad session id exited 1
  // with no write-up at all, and grok's explanation reached only the log file.
  it('surfaces the reason a run failed, first line inline and the rest indented', () => {
    const out = renderOutcome({
      ...clean,
      summary: '(no final message captured)',
      stopReason: 'incomplete',
      exitCode: 1,
      errorDetail: 'no session id or title matched "notarealsessionid"\ntry `grok sessions search`',
    });
    expect(out).toContain('⚠ error: no session id or title matched');
    expect(out).toContain('    try `grok sessions search`');
  });

  it('stays silent when nothing explained the failure', () => {
    expect(renderOutcome({ ...clean, exitCode: 1 })).not.toMatch(/error:/);
    expect(warnings({ ...clean, errorDetail: '   ' })).not.toContainEqual(
      expect.stringContaining('error:'),
    );
  });

  it('never renders model, timestamp, cost, or token counts', () => {
    const out = renderOutcome({ ...clean, costUsd: 0.4936, numTurns: 26, model: 'grok-4.6' });
    expect(out).not.toMatch(/cost/i);
    expect(out).not.toMatch(/token/i);
    expect(out).not.toContain('0.49');
    expect(out).not.toContain('grok-4.6');
    expect(out).not.toMatch(/\d+ turns/);
  });

  it('raises a stop reason that is not end_turn', () => {
    const out = renderOutcome({ ...clean, stopReason: 'max_tokens' });
    expect(out).toContain('⚠ stop reason: max_tokens');
  });

  it('raises a non-zero exit independently of the stop reason', () => {
    const out = renderOutcome({ ...clean, exitCode: 1 });
    expect(out).toContain('⚠ exit 1');
    expect(out).not.toContain('stop reason');
  });

  it('reports a watchdog kill', () => {
    const out = renderOutcome({ ...clean, killed: true });
    expect(out).toContain('⚠ run was killed before finishing');
  });

  it('reports failed commands without judging them', () => {
    const out = renderOutcome({
      ...clean,
      failedCommands: [
        { command: 'pnpm test api', exitCode: 1, output: 'FAIL src/api/client.test.ts', timedOut: false },
      ],
    });
    expect(out).toContain('⚠ 1 command exited non-zero');
    expect(out).toContain('reported, not judged');
    expect(out).toContain('pnpm test api → exit 1');
    expect(out).toContain('FAIL src/api/client.test.ts');
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

  it('says a killed job cannot be resumed rather than printing a dead session line', () => {
    const out = renderOutcome({ ...clean, killed: true, sessionLost: true });
    expect(out).toContain('cannot be resumed');
  });

  it('carries the session id when a killed job CAN be resumed', () => {
    const out = renderOutcome({ ...clean, killed: true, resumableJobId: 'abc-123' });
    expect(out).toContain('/grok:resume --resume=abc-123');
  });

  it('never prints both halves of the resume pair', () => {
    // `sessionLost` wins: it means there is no id, so a resume line would point
    // at nothing even if a caller passed one.
    const out = renderOutcome({
      ...clean,
      killed: true,
      sessionLost: true,
      resumableJobId: 'abc-123',
    });
    expect(out).toContain('cannot be resumed');
    expect(out).not.toContain('--resume=');
  });

  it('says so when grok returned nothing at all', () => {
    expect(renderOutcome({ ...clean, summary: '' })).toBe('(grok returned no write-up)\n');
  });
});

describe('warnings', () => {
  it('is empty for a clean run', () => {
    expect(warnings(clean)).toEqual([]);
  });

  it('does not collapse the stop reason and the exit code', () => {
    expect(warnings({ ...clean, stopReason: 'max_tokens', exitCode: 2 })).toEqual([
      'stop reason: max_tokens',
      'exit 2',
    ]);
  });
});
