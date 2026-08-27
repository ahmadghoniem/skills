import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  dedupePaths,
  describeToolCall,
  normalisePaths,
  parseLine,
  summariseEvents,
} from '../scripts/lib/parse.mjs';
import { FAILED_COMMAND_FIXTURE, HAPPY_FIXTURE, RELATIVE_ABSOLUTE_FIXTURE } from './helpers.mjs';

function loadFixture(path) {
  const raw = readFileSync(path, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    const ev = parseLine(line);
    if (ev) out.push(ev);
  }
  return out;
}

const GDEMO2_ROOT =
  'C:\\Users\\Ahmed Ibrahim\\AppData\\Local\\Temp\\claude\\C--Users-Ahmed-Ibrahim-Desktop\\90709031-5acd-4de5-ab3c-b9c5b0b0e356\\scratchpad\\gdemo2';

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

describe('describeToolCall', () => {
  it('returns null for non-tool_call events', () => {
    expect(describeToolCall({ type: 'text', data: 'hi' })).toBeNull();
    expect(describeToolCall(null)).toBeNull();
  });

  it('labels a search_replace by its file_path', () => {
    const events = loadFixture(HAPPY_FIXTURE);
    const call = events.find((e) => e.toolName === 'search_replace');
    expect(describeToolCall(call)).toMatch(/^search_replace → .*calc\.js$/);
  });

  it('labels a terminal command by the command string', () => {
    const events = loadFixture(HAPPY_FIXTURE);
    const call = events.find((e) => e.toolName === 'run_terminal_command');
    expect(describeToolCall(call)).toBe(
      'run_terminal_command: node -e "import(\'./calc.js\').then(m => console.log(m.divide(10, 2)))"',
    );
  });

  it('falls back to the tool name when there is no path or command', () => {
    expect(describeToolCall({ type: 'tool_call', toolName: 'grep', rawInput: { pattern: 'x' } })).toBe(
      'grep',
    );
  });
});

describe('dedupePaths / normalisePaths', () => {
  it('names the edited file in the progress line for a real tool_call', () => {
    const call = loadFixture(RELATIVE_ABSOLUTE_FIXTURE).find((e) => e.type === 'tool_call');
    expect(describeToolCall(call, '/tmp/repo')).toBe('search_replace → math.js');
  });

  it('drops an absolute path when a relative suffix of it is already present', () => {
    expect(dedupePaths(['src/foo.ts', '/tmp/repo/src/foo.ts'])).toEqual(['src/foo.ts']);
  });

  it('rewrites paths under root as repo-relative and then dedupes', () => {
    expect(normalisePaths(['/tmp/repo/src/foo.ts', 'src/foo.ts'], '/tmp/repo')).toEqual([
      'src/foo.ts',
    ]);
  });

  it('leaves paths outside root absolute', () => {
    expect(normalisePaths(['/elsewhere/x.ts'], '/tmp/repo')).toEqual(['/elsewhere/x.ts']);
  });
});

describe('summariseEvents', () => {
  it('treats stopReason end_turn as success and captures session metadata', () => {
    const s = summariseEvents(loadFixture(HAPPY_FIXTURE), GDEMO2_ROOT);
    expect(s.success).toBe(true);
    expect(s.stopReason).toBe('end_turn');
    expect(s.sessionId).toBe('01a02e4d-8d55-73f2-a26b-046282b9097d');
    expect(s.summary).toContain('Added `divide(a, b)` to `calc.js`');
  });

  it('harvests nothing from end beyond sessionId and stopReason', () => {
    const s = summariseEvents(loadFixture(HAPPY_FIXTURE), GDEMO2_ROOT);
    // The fixture's `end` carries total_cost_usd, num_turns, usage, and a
    // modelUsage map keyed `grok-4.5-build`. None may reach the summary: the
    // first two are out of scope, and `grok-4.5-build` is an internal id that
    // `--model` rejects, so persisting it would put an unusable value in the
    // job table.
    expect(s.costUsd).toBeUndefined();
    expect(s.numTurns).toBeUndefined();
    expect(s.resolvedModel).toBeUndefined();
    expect(s.filesTouched).toBeUndefined();
  });

  it('inserts a blank line between text runs that a tool call separates', () => {
    const s = summariseEvents(loadFixture(HAPPY_FIXTURE));
    expect(s.summary).toContain("I'll read `calc.js`");
    expect(s.summary).toContain('\n\n');
    expect(s.summary).toContain('Added `divide(a, b)`');
  });

  it('does not flip success when a command exits non-zero', () => {
    const s = summariseEvents(loadFixture(FAILED_COMMAND_FIXTURE));
    expect(s.success).toBe(true);
    expect(s.stopReason).toBe('end_turn');
    expect(s.failedCommands).toEqual([
      {
        command: 'git checkout nonexistent-branch-xyz',
        exitCode: 1,
        output: 'exit: 1\nerror: pathspec \'nonexistent-branch-xyz\' did not match any file(s) known to git\n',
        timedOut: false,
      },
    ]);
  });

  it('is not success when the stream has no end event', () => {
    const events = loadFixture(HAPPY_FIXTURE).filter((e) => e.type !== 'end');
    const s = summariseEvents(events);
    expect(s.success).toBe(false);
    expect(s.stopReason).toBe('incomplete');
  });

  it('is not success when stopReason is not end_turn', () => {
    const s = summariseEvents([{ type: 'end', stopReason: 'max_turns', sessionId: 's1' }]);
    expect(s.success).toBe(false);
    expect(s.stopReason).toBe('max_turns');
  });
});

describe('error events', () => {
  it('keeps the message grok sends when a run dies mid-stream', () => {
    const out = summariseEvents([
      { type: 'text', data: 'partial work' },
      { type: 'error', message: 'Internal error: inference idle timeout after 3600s' },
    ]);
    expect(out.errorDetail).toBe('Internal error: inference idle timeout after 3600s');
  });

  it('leaves errorDetail undefined on a run that raised none', () => {
    expect(summariseEvents([{ type: 'end', stopReason: 'end_turn' }]).errorDetail).toBeUndefined();
  });
});
