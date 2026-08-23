import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  dedupePaths,
  describeToolCall,
  normalisePaths,
  parseLine,
  summariseEvents,
  toolPaths,
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

describe('toolPaths / dedupePaths / normalisePaths', () => {
  it('pulls file_path from a tool_call and locations from a tool_call_update', () => {
    const events = loadFixture(RELATIVE_ABSOLUTE_FIXTURE);
    const call = events.find((e) => e.type === 'tool_call');
    const update = events.find((e) => e.type === 'tool_call_update');
    expect(toolPaths(call)).toEqual(['math.js']);
    expect(toolPaths(update)).toEqual(['math.js']);
  });

  it('falls back to a diff content path when locations are empty', () => {
    expect(
      toolPaths({
        type: 'tool_call_update',
        locations: [],
        content: [{ type: 'diff', path: '/tmp/repo/src/foo.ts' }],
      }),
    ).toEqual(['/tmp/repo/src/foo.ts']);
  });

  it('ignores read_file target_file on the tool_call itself', () => {
    // grok reports reads as `rawInput.target_file`, not `file_path`. Only an
    // edit's file_path (or a later locations/diff update) is collected.
    expect(
      toolPaths({
        type: 'tool_call',
        toolName: 'read_file',
        rawInput: { target_file: 'src/foo.ts' },
      }),
    ).toEqual([]);
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
    expect(s.resolvedModel).toBe('grok-4.5-build');
    expect(s.costUsd).toBe(0.019203744);
    expect(s.numTurns).toBe(4);
    expect(s.filesTouched).toEqual(['calc.js']);
    expect(s.summary).toContain('Added `divide(a, b)` to `calc.js`');
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

  it('collapses relative and absolute spellings of the same file into one', () => {
    const s = summariseEvents(loadFixture(RELATIVE_ABSOLUTE_FIXTURE));
    expect(s.filesTouched).toEqual(['math.js']);
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
