import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  extractChatId,
  extractResolvedModel,
  parseLine,
  summariseEvents,
} from '../scripts/lib/parse.mjs';
import {
  FAILURE_FIXTURE,
  HAPPY_FIXTURE,
  NATIVE_TOOL_CALL_FIXTURE,
  NESTED_TOOL_USE_FIXTURE,
} from './helpers.mjs';

function loadFixture(path) {
  const raw = readFileSync(path, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    const ev = parseLine(line);
    if (ev) out.push(ev);
  }
  return out;
}

describe('parse', () => {
  it('drops empty and malformed lines', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   ')).toBeNull();
    expect(parseLine('not json')).toBeNull();
    expect(parseLine('null')).toBeNull();
    expect(parseLine('{"type":"x"}')?.type).toBe('x');
  });

  it('extracts chat id from the happy-path stream', () => {
    const events = loadFixture(HAPPY_FIXTURE);
    expect(extractChatId(events)).toBe('chat_abc123');
  });

  it('extracts chat id from the failure stream', () => {
    const events = loadFixture(FAILURE_FIXTURE);
    expect(extractChatId(events)).toBe('chat_fail_999');
  });

  it('returns undefined when no chat id present', () => {
    expect(extractChatId([{ type: 'assistant' }])).toBeUndefined();
  });

  it('summarises happy-path: files touched + success text', () => {
    const events = loadFixture(HAPPY_FIXTURE);
    const s = summariseEvents(events);
    expect(s.success).toBe(true);
    expect(s.filesTouched).toEqual(expect.arrayContaining(['src/foo.ts', 'README.md']));
    expect(s.summary).toContain('Added src/foo.ts');
  });

  it('summarises failure stream: success=false and error reason', () => {
    const events = loadFixture(FAILURE_FIXTURE);
    const s = summariseEvents(events);
    expect(s.success).toBe(false);
    expect(s.exitReason).toBe('error');
    expect(s.summary).toContain('Aborted');
  });

  // Issue D: tool_use blocks are typically nested inside
  // `assistant.message.content[]` (Anthropic Messages API shape), not flat
  // on the event. filesTouched must be populated from that realistic shape,
  // via tool names (`search_replace`, `delete_file`) that a flat/narrow
  // "tool_use" check would miss.
  it('summarises a stream with nested tool_use blocks: filesTouched is populated', () => {
    const events = loadFixture(NESTED_TOOL_USE_FIXTURE);
    const s = summariseEvents(events);
    expect(s.success).toBe(true);
    expect(s.filesTouched).toEqual(expect.arrayContaining(['src/util.ts', 'src/dead.ts']));
    expect(s.summary).toContain('Refactored src/util.ts');
  });

  // Issue D (real shape): cursor-agent's native stream nests the tool NAME as a
  // key inside `tool_call` (`editToolCall`/`writeToolCall`) with the path under
  // `.args.path` — captured from a live run. A read-only tool (`readToolCall`)
  // must NOT count as a file touched.
  it('summarises the native cursor tool_call shape: only written files counted', () => {
    const events = loadFixture(NATIVE_TOOL_CALL_FIXTURE);
    const s = summariseEvents(events);
    expect(s.success).toBe(true);
    expect(s.filesTouched).toEqual(expect.arrayContaining(['demo.txt', 'src/config.json']));
    expect(s.filesTouched).not.toContain('src/should-not-count.ts');
    expect(s.summary).toContain('Created demo.txt');
  });

  it('extractResolvedModel finds a concrete model id in the stream', () => {
    const events = loadFixture(NESTED_TOOL_USE_FIXTURE);
    expect(extractResolvedModel(events)).toBe('claude-4.6-sonnet-medium');
  });

  it('extractResolvedModel returns undefined when no model field is present', () => {
    expect(extractResolvedModel(loadFixture(HAPPY_FIXTURE))).toBeUndefined();
  });

  it('records non-zero shellToolCall exit codes as failedCommands', () => {
    const events = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      {
        type: 'tool_call',
        subtype: 'completed',
        call_id: 't1',
        tool_call: {
          shellToolCall: {
            args: { command: 'grep nope' },
            result: {
              failure: {
                command: 'grep nope',
                exitCode: 1,
                stdout: '',
                stderr: 'no matches',
                interleavedOutput: 'no matches',
                aborted: false,
              },
            },
          },
        },
      },
      {
        type: 'tool_call',
        subtype: 'completed',
        call_id: 't2',
        tool_call: {
          shellToolCall: {
            args: { command: 'echo ok' },
            result: {
              success: {
                command: 'echo ok',
                exitCode: 0,
                stdout: 'ok\n',
                stderr: '',
                interleavedOutput: 'ok\n',
              },
            },
          },
        },
      },
      { type: 'result', subtype: 'success', result: 'done' },
    ];
    const s = summariseEvents(events);
    expect(s.success).toBe(true);
    expect(s.failedCommands).toEqual([
      { command: 'grep nope', exitCode: 1, output: 'no matches', timedOut: false },
    ]);
  });

  it('marks aborted shellToolCall failures as timedOut', () => {
    const events = [
      {
        type: 'tool_call',
        subtype: 'completed',
        call_id: 't-abort',
        tool_call: {
          shellToolCall: {
            args: { command: 'sleep 999' },
            result: {
              failure: {
                command: 'sleep 999',
                exitCode: 1,
                stdout: '',
                stderr: '',
                interleavedOutput: '',
                aborted: true,
              },
            },
          },
        },
      },
      { type: 'result', subtype: 'success', result: 'ok' },
    ];
    expect(summariseEvents(events).failedCommands[0].timedOut).toBe(true);
  });

  it('dedupes absolute and relative spellings of the same file under root', () => {
    const events = [
      { type: 'tool_use', name: 'write', input: { path: 'src/foo.ts' } },
      { type: 'tool_use', name: 'write', input: { path: '/tmp/repo/src/foo.ts' } },
      { type: 'result', subtype: 'success', result: 'ok' },
    ];
    expect(summariseEvents(events, '/tmp/repo').filesTouched).toEqual(['src/foo.ts']);
  });
});
