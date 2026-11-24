import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  claimsFileChanges,
  MAX_SUMMARY_CHARS,
  modelStarted,
  parseLine,
  summariseEvents,
} from '../scripts/lib/parse.mjs';
import { FAILED_COMMAND_FIXTURE, HAPPY_FIXTURE, REFUSED_FIXTURE } from './helpers.mjs';

function loadFixture(path) {
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const ev = parseLine(line);
    if (ev) out.push(ev);
  }
  return out;
}

const SESSION = 'e929dd1f-a6f6-4516-ab43-26a630f775d7';

describe('parseLine', () => {
  it('drops empty and malformed lines', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   ')).toBeNull();
    expect(parseLine('not json')).toBeNull();
    expect(parseLine('null')).toBeNull();
    expect(parseLine('[1]')).toBeNull();
    expect(parseLine('42')).toBeNull();
    expect(parseLine('{"type":"x"}')?.type).toBe('x');
  });
});

describe('summariseEvents', () => {
  it('reads a successful run: chat id, stop reason, tool calls', () => {
    const s = summariseEvents(loadFixture(HAPPY_FIXTURE));
    expect(s.success).toBe(true);
    expect(s.stopReason).toBe('success');
    expect(s.sessionId).toBe(SESSION);
    expect(s.toolCalls).toBe(3);
    expect(s.failedCommands).toEqual([]);
    expect(s.errorDetail).toBeUndefined();
  });

  // The `result` text runs the messages together ("now.Ran"); the summary
  // keeps them apart.
  it('joins whole assistant messages with a blank line', () => {
    const s = summariseEvents(loadFixture(HAPPY_FIXTURE));
    expect(s.summary).toBe(
      'Running the four steps now.\n\nRan `git status --short`, wrote `hello.txt` with “hi”, and read `a.txt`.',
    );
  });

  it('falls back to the result text when no assistant message arrived', () => {
    const s = summariseEvents([{ type: 'result', subtype: 'success', is_error: false, result: 'Done.' }]);
    expect(s.summary).toBe('Done.');
  });

  it('reports a failed command without flipping success', () => {
    const s = summariseEvents(loadFixture(FAILED_COMMAND_FIXTURE));
    expect(s.success).toBe(true);
    expect(s.commands.map((c) => c.command)).toEqual(['git status --short', 'ls does-not-exist']);
    expect(s.failedCommands).toHaveLength(1);
    expect(s.failedCommands[0]).toMatchObject({
      command: 'ls does-not-exist',
      exitCode: 2,
      timedOut: false,
    });
    expect(s.failedCommands[0].output).toContain('No such file or directory');
  });

  it('reads a run with no result event (refused) as incomplete with no write-up', () => {
    const s = summariseEvents(loadFixture(REFUSED_FIXTURE));
    expect(s.success).toBe(false);
    expect(s.stopReason).toBe('incomplete');
    expect(s.summary).toBe('');
    expect(s.toolCalls).toBe(0);
  });

  it('reads is_error as an error and keeps its text', () => {
    const s = summariseEvents([{ type: 'result', subtype: 'success', is_error: true, result: 'boom' }]);
    expect(s.success).toBe(false);
    expect(s.stopReason).toBe('error');
    expect(s.errorDetail).toBe('boom');
  });

  it('keeps a result subtype other than success as the stop reason', () => {
    const s = summariseEvents([{ type: 'result', subtype: 'error_max_turns', is_error: true }]);
    expect(s.stopReason).toBe('error_max_turns');
    expect(s.success).toBe(false);
  });
});

describe('modelStarted', () => {
  it('is false for system and user events and true from the first model event', () => {
    const events = loadFixture(HAPPY_FIXTURE);
    expect(modelStarted(events[0])).toBe(false);
    expect(modelStarted(events[1])).toBe(false);
    expect(events.some(modelStarted)).toBe(true);
    expect(loadFixture(REFUSED_FIXTURE).some(modelStarted)).toBe(false);
  });
});

describe('claimsFileChanges', () => {
  it.each([
    'Created src/a.mjs with the retry helper.',
    'I updated the file and ran the tests.',
    'Wrote [notes](docs/notes) for the next step.',
    'Modified [greet](file:///C:/repo/greet) to export the helper.',
  ])('reads %j as a claim', (text) => {
    expect(claimsFileChanges(text)).toBe(true);
  });

  it.each([
    'Six of them open `file://` playgrounds.\nNone of them start the CLI.',
    "Google's [pricing](https://ai.google.dev/gemini-api/docs/pricing) (updated 16 Oct 2026): $0.75 per million tokens.",
    'The plan was updated.\nSee README.md for the rest.',
  ])('does not read %j as a claim', (text) => {
    expect(claimsFileChanges(text)).toBe(false);
  });
});

describe('write-up length', () => {
  const long = (n) => [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(n) }] } },
  ];

  it('keeps a long answer whole', () => {
    const out = summariseEvents(long(30_000));
    expect(out.summary.length).toBe(30_000);
    expect(out.summary).not.toContain('truncated');
  });

  it('says so, and where the rest is, when the storage ceiling fires', () => {
    const out = summariseEvents(long(MAX_SUMMARY_CHARS + 500));
    expect(out.summary).toContain(`${MAX_SUMMARY_CHARS + 500} characters produced`);
    expect(out.summary).toContain('.ndjson');
  });
});
