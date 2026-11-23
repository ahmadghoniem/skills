import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEvents, parseLine, summariseEvents } from '../scripts/lib/parse.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** A real `opencode run --format json` stream: read, bash, write, then a report. */
const REAL_RUN = readFileSync(join(here, 'fixtures', 'run-with-tools.ndjson'), 'utf8');

describe('parseLine', () => {
  it('returns null for blank and malformed lines', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   ')).toBeNull();
    expect(parseLine('not json')).toBeNull();
    expect(parseLine('[1,2]')).toBeNull();
    expect(parseLine('null')).toBeNull();
  });

  it('parses an event envelope', () => {
    expect(parseLine('{"type":"text","sessionID":"ses_a"}')).toEqual({
      type: 'text',
      sessionID: 'ses_a',
    });
  });
});

describe('parseEvents', () => {
  it('is empty for empty input', () => {
    expect(parseEvents('')).toEqual([]);
    expect(parseEvents(null)).toEqual([]);
  });

  it('keeps the good lines and drops the torn one', () => {
    const text = '{"type":"a"}\n{"type":"b"\n{"type":"c"}\n';
    expect(parseEvents(text).map((e) => e.type)).toEqual(['a', 'c']);
  });
});

describe('summariseEvents on a real run', () => {
  const summary = summariseEvents(parseEvents(REAL_RUN));

  it('picks up the session id', () => {
    expect(summary.sessionId).toMatch(/^ses_/);
  });

  it('joins the assistant text into the report', () => {
    expect(summary.response).toContain('a.txt');
    expect(summary.response.endsWith(' ')).toBe(false);
  });

  it('ends on a stop reason', () => {
    expect(summary.finishReason).toBe('stop');
  });

  it('counts every tool call', () => {
    expect(summary.toolCalls).toBe(3);
    expect(summary.lastTool).toBe('write');
  });

  it('does NOT count a shell command that ran and failed as a tool error', () => {
    // The fixture ran `nonexistent-cmd-xyz`. opencode marks that tool
    // `completed` with the shell error in its output, so the plugin must not
    // claim a tool failed to run. contract.md documents this.
    expect(summary.toolErrors).toEqual([]);
  });

  it('sums cost and tokens across steps', () => {
    expect(summary.costUsd).toBeGreaterThan(0);
    expect(summary.tokens.input).toBeGreaterThan(0);
    expect(summary.tokens.output).toBeGreaterThan(0);
    expect(summary.tokens.cacheRead).toBeGreaterThan(0);
  });

  it('derives a duration from the event timestamps', () => {
    expect(summary.durationSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('summariseEvents on the unhappy paths', () => {
  it('reports a tool that could not run at all', () => {
    const events = [
      {
        type: 'tool_use',
        part: { tool: 'bash', state: { status: 'error', error: 'permission denied\nline two' } },
      },
    ];
    expect(summariseEvents(events).toolErrors).toEqual([
      { tool: 'bash', message: 'permission denied\nline two' },
    ]);
  });

  it('pulls a message out of an object-shaped tool error', () => {
    const events = [
      { type: 'tool_use', part: { tool: 'edit', state: { status: 'error', error: { message: 'no such file' } } } },
    ];
    expect(summariseEvents(events).toolErrors[0].message).toBe('no such file');
  });

  it('keeps the last finish reason when a run ends mid-tool', () => {
    const events = [
      { type: 'step_finish', part: { reason: 'stop' } },
      { type: 'step_finish', part: { reason: 'tool-calls' } },
    ];
    expect(summariseEvents(events).finishReason).toBe('tool-calls');
  });

  it('has no session id and no reason when nothing was emitted', () => {
    const summary = summariseEvents([]);
    expect(summary.sessionId).toBeUndefined();
    expect(summary.finishReason).toBeNull();
    expect(summary.response).toBe('');
    expect(summary.costUsd).toBe(0);
  });

  it('survives junk in the event list', () => {
    expect(() => summariseEvents([null, 'nope', 42, { type: 'text' }])).not.toThrow();
  });

  it('carries an error envelope through', () => {
    const events = [{ type: 'error', part: { message: 'provider returned 503' } }];
    expect(summariseEvents(events).error).toBe('provider returned 503');
  });
});

describe('a real provider error envelope', () => {
  // Shape observed live from opencode 1.18.31 against an uncredentialed
  // provider: the sentence is at data.message and the object also carries the
  // full HTTP response — headers, NEL report URLs, the body. Reaching for
  // err.message alone printed all ~900 characters as one ⚠ line.
  const envelope = {
    name: 'APIError',
    data: {
      message: 'You do not have an active subscription. Please upgrade your plan.',
      statusCode: 403,
      isRetryable: false,
      responseHeaders: { 'cf-ray': 'a3db33e5a9e2e1ed-MRS', server: 'cloudflare' },
      responseBody: '{"error":{"code":"upgrade_required"}}',
    },
  };

  it('reports the nested message with its status, not the envelope', () => {
    const summary = summariseEvents([{ type: 'error', part: { error: envelope } }]);
    expect(summary.error).toBe(
      'APIError 403: You do not have an active subscription. Please upgrade your plan.',
    );
  });

  it('never lets an unreadable object run past 300 characters', () => {
    const blob = { nope: 'x'.repeat(2000) };
    const summary = summariseEvents([{ type: 'error', part: { error: blob } }]);
    expect(summary.error.length).toBeLessThan(340);
    expect(summary.error).toContain('full text in the job log');
  });
});
