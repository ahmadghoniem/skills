import { describe, expect, it } from 'vitest';
import {
  collapseCommandArgv,
  parseArgv,
  parseCommandArgv,
  parseTimeout,
  splitArgString,
} from '../scripts/lib/util/args.mjs';

describe('splitArgString', () => {
  it('splits on whitespace', () => {
    expect(splitArgString('--model gemini-3.1-pro-high hello world')).toEqual([
      '--model',
      'gemini-3.1-pro-high',
      'hello',
      'world',
    ]);
  });

  it('preserves double-quoted spans', () => {
    expect(splitArgString('--model gemini-3.1-pro-high "write a haiku about git"')).toEqual([
      '--model',
      'gemini-3.1-pro-high',
      'write a haiku about git',
    ]);
  });

  it('preserves single-quoted spans', () => {
    expect(splitArgString("--flag 'value with spaces'")).toEqual(['--flag', 'value with spaces']);
  });

  it('treats backslashes inside single quotes as literal', () => {
    expect(splitArgString("'a\\b'")).toEqual(['a\\b']);
  });

  it('honours a backslash escape inside double quotes', () => {
    expect(splitArgString('"a\\"b"')).toEqual(['a"b']);
  });

  it('honours a backslash escape outside quotes', () => {
    expect(splitArgString('a\\ b')).toEqual(['a b']);
  });

  it('keeps a trailing lone backslash rather than dropping the escape', () => {
    expect(splitArgString('a\\')).toEqual(['a\\']);
  });

  it('splits on tabs and newlines as well as spaces', () => {
    expect(splitArgString('a\tb\nc')).toEqual(['a', 'b', 'c']);
  });
});

describe('a `--` inside the task text does not swallow flags', () => {
  it('keeps flags that follow a `--` in the user text', () => {
    const r = parseCommandArgv(['--', 'fix the bug -- see notes', '--model', 'gemini-3.1-pro-high']);
    expect(r.flags['model']).toBe('gemini-3.1-pro-high');
    expect(r.positional.join(' ')).toBe('fix the bug -- see notes');
  });

  it('keeps flags when the whole invocation arrives as --arg-string', () => {
    const r = parseCommandArgv([
      '--',
      '--arg-string',
      'fix the bug -- see notes --model gemini-3.1-pro-high --timeout 60',
    ]);
    expect(r.flags['model']).toBe('gemini-3.1-pro-high');
    expect(r.flags['timeout']).toBe(60);
    expect(r.positional.join(' ')).toBe('fix the bug -- see notes');
  });

  it('still honours `--` for direct parseArgv callers', () => {
    const r = parseArgv(['a', '--', '--model', 'gemini-3.1-pro-high']);
    expect(r.flags['model']).toBeUndefined();
    expect(r.positional).toEqual(['a', '--model', 'gemini-3.1-pro-high']);
  });

  it('treats `--` as ordinary text when honorDoubleDash is false', () => {
    const r = parseArgv(['a', '--', '--model', 'gemini-3.1-pro-high'], [], { honorDoubleDash: false });
    expect(r.flags['model']).toBe('gemini-3.1-pro-high');
    expect(r.positional).toEqual(['a', '--']);
  });
});

describe('parseArgv', () => {
  it('splits positional vs flags', () => {
    const r = parseArgv(['--model', 'gemini-3.1-pro-high', '--sandbox', 'do', 'thing'], ['sandbox']);
    expect(r.flags['model']).toBe('gemini-3.1-pro-high');
    expect(r.flags['sandbox']).toBe(true);
    expect(r.positional).toEqual(['do', 'thing']);
  });

  it('handles --no-* negation, populating both kebab and camel', () => {
    const r = parseArgv(['--no-git-check'], ['git-check']);
    expect(r.flags['git-check']).toBe(false);
    expect(r.flags['gitCheck']).toBe(false);
  });

  it('populates kebab and camel for a positive kebab flag', () => {
    const r = parseArgv(['--git-check'], ['git-check']);
    expect(r.flags['git-check']).toBe(true);
    expect(r.flags['gitCheck']).toBe(true);
  });

  it('auto-casts numeric flag values', () => {
    const r = parseArgv(['--timeout', '60'], []);
    expect(r.flags['timeout']).toBe(60);
  });

  it('does not cast an integer that would lose precision', () => {
    const r = parseArgv(['--id', '12345678901234567890'], []);
    expect(r.flags['id']).toBe('12345678901234567890');
  });

  it('handles --foo=value form', () => {
    const r = parseArgv(['--conversation=b8b3e36f-3fb0-4d55-a0ee-8a839b4b0fe4', '--model=gemini-3.1-pro-high'], []);
    expect(r.flags['conversation']).toBe('b8b3e36f-3fb0-4d55-a0ee-8a839b4b0fe4');
    expect(r.flags['model']).toBe('gemini-3.1-pro-high');
  });

  it('treats everything after -- as positional', () => {
    const r = parseArgv(['--model', 'gemini-3.1-pro-high', '--', '--weird', 'arg'], []);
    expect(r.flags['model']).toBe('gemini-3.1-pro-high');
    expect(r.positional).toEqual(['--weird', 'arg']);
  });

  it('boolean flag does not consume next token', () => {
    const r = parseArgv(['--sandbox', 'task-text'], ['sandbox']);
    expect(r.flags['sandbox']).toBe(true);
    expect(r.positional).toEqual(['task-text']);
  });

  it('undeclared flag with no following value becomes true', () => {
    const r = parseArgv(['--plan'], []);
    expect(r.flags['plan']).toBe(true);
  });

  it('undeclared flag does not consume a following flag-looking token', () => {
    const r = parseArgv(['--model', '--verbose'], []);
    expect(r.flags['model']).toBe(true);
    expect(r.flags['verbose']).toBe(true);
  });

  it('--continue followed by a prompt does not eat the prompt token', () => {
    const r = parseArgv(['--continue', 'fix', 'the', 'parser'], ['continue']);
    expect(r.flags['continue']).toBe(true);
    expect(r.positional).toEqual(['fix', 'the', 'parser']);
  });

  it('keeps the inline value of --no-foo=value instead of discarding it', () => {
    const { flags } = parseArgv(['--no-cache=5']);
    expect(flags['no-cache']).toBe(5);
    expect(flags['cache']).toBeUndefined();
  });
});

describe('collapseCommandArgv', () => {
  it('passes through a real-shell path that contains spaces', () => {
    expect(collapseCommandArgv(['--', '--model', '/c/Users/Ahmed Ibrahim/x'])).toEqual([
      '--model',
      '/c/Users/Ahmed Ibrahim/x',
    ]);
  });

  it('splits an --arg-string blob and merges it in order', () => {
    expect(collapseCommandArgv(['--', '--arg-string', '--sandbox fix the parser'])).toEqual([
      '--sandbox',
      'fix',
      'the',
      'parser',
    ]);
  });

  it('preserves newlines when --arg-string is absent', () => {
    expect(collapseCommandArgv(['--', 'line one\nline two'])).toEqual(['line one\nline two']);
  });

  it('leaves already-split argv untouched', () => {
    expect(collapseCommandArgv(['--model', 'gemini-3.1-pro-high', '--', 'do "a thing"'])).toEqual([
      '--model',
      'gemini-3.1-pro-high',
      'do "a thing"',
    ]);
  });

  it('splits only an explicit --arg-string blob', () => {
    expect(
      collapseCommandArgv(['--model', 'gemini-3.1-pro-high', '--', '--arg-string', 'do "a thing"']),
    ).toEqual(['--model', 'gemini-3.1-pro-high', 'do', 'a thing']);
  });

  it('drops a trailing --arg-string with no blob', () => {
    expect(collapseCommandArgv(['--', '--arg-string'])).toEqual([]);
  });
});

describe('acceptance: --arg-string round-trip', () => {
  it('parses flags and leaves the task text as `do the thing`', () => {
    const r = parseCommandArgv(
      ['--arg-string', '--sandbox --model gemini-3.1-pro-high do the thing'],
      ['sandbox', 'continue'],
    );
    expect(r.flags.sandbox).toBe(true);
    expect(r.flags.model).toBe('gemini-3.1-pro-high');
    expect(r.positional.join(' ')).toBe('do the thing');
  });
});

describe('parseTimeout', () => {
  it('falls back for junk, zero, and negatives', () => {
    expect(parseTimeout('abc')).toBe(900);
    expect(parseTimeout('0')).toBe(900);
    expect(parseTimeout(0)).toBe(900);
    expect(parseTimeout(-1)).toBe(900);
    expect(parseTimeout('-10')).toBe(900);
    expect(parseTimeout(undefined)).toBe(900);
    expect(parseTimeout('')).toBe(900);
    expect(parseTimeout(Number.NaN)).toBe(900);
  });

  it('keeps a positive number or numeric string', () => {
    expect(parseTimeout('60')).toBe(60);
    expect(parseTimeout(45)).toBe(45);
  });

  it('honours a custom fallback', () => {
    expect(parseTimeout('x', 5)).toBe(5);
    expect(parseTimeout(0, 3600)).toBe(3600);
  });
});
