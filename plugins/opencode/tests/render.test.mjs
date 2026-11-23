import { describe, expect, it } from 'vitest';
import { anomalies, isUnfinished, renderResult, renderStats } from '../scripts/lib/render.mjs';

/** @returns {import('../scripts/lib/render.mjs').ResultView} */
function job(patch = {}) {
  return {
    id: 'rename-thing-a7f3',
    status: 'done',
    finishReason: 'stop',
    exitCode: 0,
    sessionId: 'ses_abc',
    summary: 'Renamed X to Y in src/a.mjs.',
    model: 'nebius/deepseek-ai/DeepSeek-V4.1-Flash',
    costUsd: 0.0178,
    tokens: { input: 17339, output: 323, cacheRead: 20736 },
    toolCalls: 3,
    durationSeconds: 14.2,
    ...patch,
  };
}

const ids = (j) => anomalies(j).map((a) => a.id);

describe('a clean run', () => {
  it('raises no warnings', () => {
    expect(ids(job())).toEqual([]);
  });

  it('renders the report and a stats line, nothing else', () => {
    const out = renderResult(job());
    expect(out).toContain('Renamed X to Y');
    expect(out).not.toContain('⚠');
    expect(out.trim().split('\n').pop()).toContain('$0.02');
  });

  it('is not unfinished', () => {
    expect(isUnfinished(job())).toBe(false);
  });
});

describe('finish reasons', () => {
  it('says nothing about stop', () => {
    expect(ids(job({ finishReason: 'stop' }))).toEqual([]);
  });

  it('explains tool-calls as a partial run and offers resume', () => {
    const out = anomalies(job({ finishReason: 'tool-calls' }));
    expect(out.map((a) => a.id)).toEqual(['finish-reason', 'resume']);
    expect(out[0].detail[0]).toContain('partial');
  });

  it('reports an unknown reason verbatim with no invented explanation', () => {
    const [first] = anomalies(job({ finishReason: 'banana' }));
    expect(first.line).toContain('banana');
    expect(first.detail).toBeUndefined();
  });

  it('marks a run with no write-up', () => {
    const [first] = anomalies(job({ finishReason: 'length', summary: '' }));
    expect(first.line).toContain('(no write-up)');
  });
});

describe('independent facts stay independent', () => {
  it('fires exit and finish-reason separately', () => {
    expect(ids(job({ finishReason: 'error', exitCode: 1 }))).toEqual([
      'finish-reason',
      'exit',
      'resume',
    ]);
  });

  it('shows stderr on an otherwise clean run', () => {
    const out = anomalies(job({ stderrTail: ['no such model: foo/bar'] }));
    expect(out.map((a) => a.id)).toEqual(['stderr']);
    expect(out[0].detail).toEqual(['no such model: foo/bar']);
  });
});

describe('tool errors', () => {
  it('dedupes and caps at three', () => {
    const toolErrors = [
      { tool: 'bash', message: 'a' },
      { tool: 'bash', message: 'a' },
      { tool: 'read', message: 'b' },
      { tool: 'edit', message: 'c' },
      { tool: 'write', message: 'd' },
    ];
    const [first] = anomalies(job({ toolErrors }));
    expect(first.line).toContain('4 tool calls');
    expect(first.detail).toHaveLength(4);
    expect(first.detail[3]).toBe('… and 1 more');
  });

  it('keeps only the first line of a multi-line message', () => {
    const [first] = anomalies(job({ toolErrors: [{ tool: 'bash', message: 'boom\ndetail' }] }));
    expect(first.detail).toEqual(['bash: boom']);
  });
});

describe('a run that never started', () => {
  const dead = job({
    status: 'failed',
    finishReason: null,
    exitCode: 1,
    sessionId: undefined,
    summary: '',
    stderrTail: ['Error: unknown model'],
    costUsd: undefined,
    tokens: undefined,
    toolCalls: undefined,
    durationSeconds: undefined,
  });

  it('says so and offers no resume', () => {
    expect(ids(dead)).toEqual(['exit', 'stderr', 'no-session']);
  });

  it('renders warnings alone when there is no report', () => {
    const out = renderResult(dead);
    expect(out).toContain('opened no session');
    expect(out).not.toContain('(opencode returned no report)');
  });

  it('is unfinished', () => {
    expect(isUnfinished(dead)).toBe(true);
  });
});

describe('the watchdog', () => {
  it('reports the kill and offers resume when a session exists', () => {
    expect(ids(job({ status: 'failed', killed: true, finishReason: 'tool-calls' }))).toEqual([
      'finish-reason',
      'watchdog',
      'resume',
    ]);
  });
});

describe('a still-running job', () => {
  it('does not claim it opened no session before it has', () => {
    expect(ids(job({ status: 'running', sessionId: undefined, finishReason: null }))).toEqual([]);
  });
});

describe('renderStats', () => {
  it('shows sub-cent runs to four places', () => {
    expect(renderStats(job({ costUsd: 0.0059 }))).toContain('$0.0059');
  });

  it('is null when there is nothing to report', () => {
    expect(
      renderStats({ id: 'x', model: undefined, costUsd: 0, tokens: undefined, toolCalls: 0 }),
    ).toBeNull();
  });

  it('omits the cache figure when nothing was cached', () => {
    expect(renderStats(job({ tokens: { input: 10, output: 2 } }))).not.toContain('cached');
  });
});

describe('renderResult with neither report nor warnings', () => {
  it('says opencode returned nothing', () => {
    expect(
      renderResult({ id: 'x', status: 'done', finishReason: 'stop', exitCode: 0, sessionId: 'ses_a' }),
    ).toContain('(opencode returned no report)');
  });
});

describe('a run that opened a session and never completed a step', () => {
  // The provider-error shape. There IS a session id, so `no-session` cannot
  // fire; without `no-finish` this rendered as a success with exit 0.
  const stalled = job({
    status: 'failed',
    finishReason: null,
    exitCode: 1,
    sessionId: 'ses_abc',
    summary: '',
    error: 'APIError 403: You do not have an active subscription.',
    costUsd: undefined,
    tokens: undefined,
    toolCalls: undefined,
    durationSeconds: undefined,
  });

  it('says no work was done, and does not claim there was no session', () => {
    const out = ids(stalled);
    expect(out).toContain('no-finish');
    expect(out).not.toContain('no-session');
  });

  it('counts as unfinished, so the caller gets exit 1', () => {
    expect(isUnfinished(stalled)).toBe(true);
  });

  it('is unfinished even when the plugin recorded the job as done', () => {
    expect(isUnfinished({ ...stalled, status: 'done', exitCode: 0 })).toBe(true);
  });

  it('stays quiet while the job is still running', () => {
    expect(ids(job({ status: 'running', finishReason: null, sessionId: 'ses_abc' }))).toEqual([]);
  });

  it('offers resume, since the session survives', () => {
    expect(ids(stalled)).toContain('resume');
  });
});
