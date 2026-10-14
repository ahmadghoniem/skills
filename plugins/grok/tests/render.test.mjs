import { describe, expect, it } from 'vitest';
import { isUnfinished, renderResult, warnings } from '../scripts/lib/render.mjs';

const clean = {
  id: 'add-retry-to-the-client-a7f3',
  status: 'done',
  summary: 'Added retry-on-429 to src/api/client.ts and a covering test.\n',
  stopReason: 'end_turn',
  exitCode: 0,
  failedCommands: [],
};

describe('renderResult', () => {
  it('a clean run is grok’s write-up and nothing else', () => {
    expect(renderResult(clean)).toBe(
      'Added retry-on-429 to src/api/client.ts and a covering test.\n',
    );
  });

  it('never echoes the prompt back', () => {
    const out = renderResult({ ...clean, prompt: 'a five kilobyte brief' });
    expect(out).not.toContain('five kilobyte');
    expect(out).not.toMatch(/prompt/i);
  });

  it('never lists files touched — that list conflated reads with writes', () => {
    const out = renderResult({
      ...clean,
      filesTouched: ['src/api/client.ts', 'docs/only-read-this-one.md'],
    });
    expect(out).not.toContain('only-read-this-one');
    expect(out).not.toMatch(/files touched/i);
  });

  // The case this was written for: a run refused for a bad session id exited 1
  // with no write-up at all, and grok's explanation reached only the log file.
  it('surfaces the reason a run failed, first line inline and the rest indented', () => {
    const out = renderResult({
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
    expect(renderResult({ ...clean, exitCode: 1 })).not.toMatch(/error:/);
    expect(warnings({ ...clean, errorDetail: '   ' })).not.toContainEqual(
      expect.stringContaining('error:'),
    );
  });

  it('never renders model, timestamp, cost, or token counts', () => {
    const out = renderResult({ ...clean, costUsd: 0.4936, numTurns: 26, model: 'grok-4.6' });
    expect(out).not.toMatch(/cost/i);
    expect(out).not.toMatch(/token/i);
    expect(out).not.toContain('0.49');
    expect(out).not.toContain('grok-4.6');
    expect(out).not.toMatch(/\d+ turns/);
  });

  it('raises a stop reason that is not end_turn', () => {
    const out = renderResult({ ...clean, stopReason: 'max_tokens' });
    expect(out).toContain('⚠ stop reason: max_tokens');
  });

  it('raises a non-zero exit independently of the stop reason', () => {
    const out = renderResult({ ...clean, exitCode: 1 });
    expect(out).toContain('⚠ exit 1');
    expect(out).not.toContain('stop reason');
  });

  it('reports a watchdog kill', () => {
    const out = renderResult({ ...clean, killed: true });
    expect(out).toContain('⚠ run was killed before finishing');
  });

  it('reports failed commands without judging them', () => {
    const out = renderResult({
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
    const out = renderResult({
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

  it('offers a resume by job id on an unfinished run that started a session', () => {
    const sid = '0b9e7c1e-3c55-4a51-9c2e-2f4c8e0f6a11';
    const killed = renderResult({ ...clean, killed: true, grokSessionId: sid });
    expect(killed).toContain(
      '⚠ this run can be resumed where it stopped: /grok:resume add-retry-to-the-client-a7f3',
    );
    expect(renderResult({ ...clean, status: 'failed', exitCode: 1, grokSessionId: sid })).toContain(
      '/grok:resume',
    );
  });

  // A run refused before grok started (not signed in, a rejected flag) never
  // recorded a session, so a resume line would point at nothing.
  it('offers no resume when no session was recorded', () => {
    expect(renderResult({ ...clean, killed: true })).not.toContain('/grok:resume');
  });

  it('offers no resume on a finished run', () => {
    expect(renderResult({ ...clean, grokSessionId: 'x' })).not.toContain('/grok:resume');
  });

  it('says so when grok returned nothing at all', () => {
    expect(renderResult({ ...clean, summary: '' })).toBe('(grok returned no write-up)\n');
  });
});

describe('isUnfinished', () => {
  it('is true for each status that means the run did not complete', () => {
    expect(isUnfinished({ status: 'failed' })).toBe(true);
    expect(isUnfinished({ status: 'cancelled' })).toBe(true);
    expect(isUnfinished({ status: 'orphaned' })).toBe(true);
  });

  it('is true when the watchdog killed the run', () => {
    expect(isUnfinished({ status: 'done', killed: true })).toBe(true);
  });

  it('is false for a done run', () => {
    expect(isUnfinished({ status: 'done' })).toBe(false);
  });
});

describe('warnings', () => {
  it('is empty for a clean run', () => {
    expect(warnings(clean)).toEqual([]);
  });

  it('does not collapse the stop reason and the exit code', () => {
    expect(warnings({ ...clean, stopReason: 'max_tokens', exitCode: 2 })).toEqual([
      { id: 'stop-reason', line: 'stop reason: max_tokens' },
      { id: 'exit', line: 'exit 2' },
    ]);
  });

  // Backported from agy. Gated on both halves: a write-up that claims changes,
  // and a tree that shows none.
  it('raises wander when the write-up claims changes the tree does not show', () => {
    const view = { ...clean, summary: 'created src/a.mjs', gitRepo: true, gitFiles: [], claimedFileChanges: true };
    expect(warnings(view).map((w) => w.id)).toEqual(['wander']);
  });

  it('stays quiet when the tree actually changed', () => {
    const view = {
      ...clean,
      gitRepo: true,
      gitFiles: [{ status: 'M', path: 'src/a.mjs' }],
      claimedFileChanges: true,
    };
    expect(warnings(view)).toEqual([]);
  });

  // Outside a repo there is no tree to compare against, so silence is the
  // honest answer rather than a false alarm.
  it('stays quiet outside a git repo', () => {
    expect(warnings({ ...clean, gitRepo: false, gitFiles: [], claimedFileChanges: true })).toEqual([]);
  });
});
