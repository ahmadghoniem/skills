import { describe, expect, it } from 'vitest';
import { collapseCommandArgv, parseCommandArgv, parseTimeout, splitArgString } from '../scripts/lib/args.mjs';

const parse = (argv, booleans) => parseCommandArgv(argv, booleans);

describe('splitArgString', () => {
  it('splits on spaces, tabs and newlines', () => {
    expect(splitArgString('--model composer-2 hello\tworld\nnow')).toEqual(['--model', 'composer-2', 'hello', 'world', 'now']);
  });

  it('keeps double- and single-quoted spans whole', () => {
    expect(splitArgString(`--model 'composer 2' "write a haiku"`)).toEqual(['--model', 'composer 2', 'write a haiku']);
  });

  it('treats backslashes inside single quotes as literal', () => {
    expect(splitArgString("'a\\b'")).toEqual(['a\\b']);
  });

  it('honours a backslash escape inside double quotes and outside quotes', () => {
    expect(splitArgString('"a\\"b"')).toEqual(['a"b']);
    expect(splitArgString('a\\ b')).toEqual(['a b']);
  });

  it('keeps a trailing lone backslash rather than dropping the escape', () => {
    expect(splitArgString('a\\')).toEqual(['a\\']);
  });
});

describe('a `--` inside the task text does not swallow flags', () => {
  // Regression: a task containing a bare `--` used to end flag parsing, so
  // `--model` never arrived and the job silently ran on the default model.
  it('keeps flags that follow a `--` in the user text', () => {
    const r = parse(['--', 'fix the bug -- see notes', '--model', 'composer-2']);
    expect(r.flags['model']).toBe('composer-2');
    expect(r.positional.join(' ')).toBe('fix the bug -- see notes');
  });

  it('keeps flags when the whole invocation arrives as --arg-string', () => {
    const r = parse(['--', '--arg-string', 'fix the bug -- see notes --model composer-2 --timeout 60']);
    expect(r.flags['model']).toBe('composer-2');
    expect(r.flags['timeout']).toBe(60);
    expect(r.positional.join(' ')).toBe('fix the bug -- see notes');
  });
});

describe('parseCommandArgv flags', () => {
  it('splits positionals from flags, and a boolean flag does not take the next token', () => {
    const r = parse(['--model', 'composer-2', '--help', 'do', 'thing'], ['help']);
    expect(r.flags['model']).toBe('composer-2');
    expect(r.flags['help']).toBe(true);
    expect(r.positional).toEqual(['do', 'thing']);
  });

  it('negates --no-foo, and fills the camelCase name of a kebab flag', () => {
    expect(parse(['--no-color']).flags['color']).toBe(false);
    expect(parse(['--prompt-file', 'a.md']).flags['promptFile']).toBe('a.md');
  });

  it('keeps the inline value of --no-foo=value instead of discarding it', () => {
    const { flags } = parse(['--no-cache=5']);
    expect(flags['no-cache']).toBe(5);
    expect(flags['cache']).toBeUndefined();
  });

  it('reads --foo=value, and casts numbers only when they round-trip', () => {
    const { flags } = parse(['--model=composer-2', '--timeout', '60', '--id', '12345678901234567890']);
    expect(flags['model']).toBe('composer-2');
    expect(flags['timeout']).toBe(60);
    expect(flags['id']).toBe('12345678901234567890');
  });

  it('an undeclared flag with no value, or followed by another flag, becomes true', () => {
    const { flags } = parse(['--model', '--fresh']);
    expect(flags['model']).toBe(true);
    expect(flags['fresh']).toBe(true);
  });
});

describe('collapseCommandArgv', () => {
  it('passes through a real-shell path that contains spaces', () => {
    expect(collapseCommandArgv(['--', '--prompt-file', '/c/Users/Ahmed Ibrahim/x.md'])).toEqual(['--prompt-file', '/c/Users/Ahmed Ibrahim/x.md']);
  });

  it('preserves newlines when --arg-string is absent', () => {
    expect(collapseCommandArgv(['--', 'line one\nline two'])).toEqual(['line one\nline two']);
  });

  it('splits only an explicit --arg-string blob, in place', () => {
    expect(collapseCommandArgv(['--model', 'composer-2', '--', '--arg-string', 'do "a thing"'])).toEqual(['--model', 'composer-2', 'do', 'a thing']);
  });

  it('drops a trailing --arg-string with no blob', () => {
    expect(collapseCommandArgv(['--', '--arg-string'])).toEqual([]);
  });
});

describe('parseTimeout', () => {
  it('falls back for junk, zero, and negatives', () => {
    for (const raw of ['abc', '0', 0, -1, '-10', -0.5, undefined, '', Number.NaN]) expect(parseTimeout(raw)).toBe(1800);
    expect(parseTimeout('x', 5)).toBe(5);
  });

  it('keeps a positive number or numeric string', () => {
    expect(parseTimeout('60')).toBe(60);
    expect(parseTimeout(45)).toBe(45);
  });
});
