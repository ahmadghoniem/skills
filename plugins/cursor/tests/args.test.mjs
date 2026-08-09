import { describe, expect, it } from 'vitest';
import {
  collapseArguments,
  parseArgv,
  parseCommandArgv,
  splitArgString,
} from '../scripts/lib/args.mjs';

describe('splitArgString', () => {
  it('splits on whitespace', () => {
    expect(splitArgString('--model composer hello world')).toEqual([
      '--model',
      'composer',
      'hello',
      'world',
    ]);
  });

  it('preserves double-quoted spans', () => {
    expect(splitArgString('--model opus "write a haiku about git"')).toEqual([
      '--model',
      'opus',
      'write a haiku about git',
    ]);
  });

  it('preserves single-quoted spans', () => {
    expect(splitArgString("--flag 'value with spaces'")).toEqual(['--flag', 'value with spaces']);
  });
});

describe('a `--` inside the task text does not swallow flags', () => {
  // Regression: a task containing a bare `--` used to flip parseArgv into
  // end-of-flags mode, so `--model` never arrived and the job silently ran on
  // the default model while reporting success.
  it('keeps flags that follow a `--` in the user text', () => {
    const r = parseCommandArgv(['--', 'fix the bug -- see notes', '--model', 'composer-2.5']);
    expect(r.flags['model']).toBe('composer-2.5');
    expect(r.positional.join(' ')).toBe('fix the bug -- see notes');
  });

  it('keeps flags when the whole invocation arrives as one string', () => {
    const r = parseCommandArgv([
      '--',
      'fix the bug -- see notes --model composer-2.5 --timeout 60',
    ]);
    expect(r.flags['model']).toBe('composer-2.5');
    expect(r.flags['timeout']).toBe(60);
    expect(r.positional.join(' ')).toBe('fix the bug -- see notes');
  });

  it('still honours `--` for direct parseArgv callers', () => {
    const r = parseArgv(['a', '--', '--model', 'opus']);
    expect(r.flags['model']).toBeUndefined();
    expect(r.positional).toEqual(['a', '--model', 'opus']);
  });
});

describe('parseArgv', () => {
  it('splits positional vs flags', () => {
    const r = parseArgv(['--model', 'opus', '--background', 'do', 'thing'], ['background']);
    expect(r.flags['model']).toBe('opus');
    expect(r.flags['background']).toBe(true);
    expect(r.positional).toEqual(['do', 'thing']);
  });

  it('handles --no-* negation, populating both kebab and camel', () => {
    const r = parseArgv(['--no-git-check'], ['git-check']);
    expect(r.flags['git-check']).toBe(false);
    expect(r.flags['gitCheck']).toBe(false);
  });

  it('auto-casts numeric flag values', () => {
    const r = parseArgv(['--timeout', '60'], []);
    expect(r.flags['timeout']).toBe(60);
  });

  it('handles --foo=value form', () => {
    const r = parseArgv(['--resume=chat_abc', '--model=opus'], []);
    expect(r.flags['resume']).toBe('chat_abc');
    expect(r.flags['model']).toBe('opus');
  });

  it('treats everything after -- as positional', () => {
    const r = parseArgv(['--model', 'opus', '--', '--weird', 'arg'], []);
    expect(r.flags['model']).toBe('opus');
    expect(r.positional).toEqual(['--weird', 'arg']);
  });

  it('boolean flag does not consume next token', () => {
    const r = parseArgv(['--background', 'task-text'], ['background']);
    expect(r.flags['background']).toBe(true);
    expect(r.positional).toEqual(['task-text']);
  });

  // Regression: resume.mjs unshifts `--resume` onto argv. Before declaring
  // `resume` as boolean this consumed the first prompt word as chat-id,
  // producing bogus `--resume=<word>` calls to cursor-agent.
  it('--resume followed by a prompt does not eat the prompt token', () => {
    const r = parseArgv(['--resume', 'řekni', 'mi', 'něco', 'o', 'teto', 'službě'], ['resume']);
    expect(r.flags['resume']).toBe(true);
    expect(r.positional).toEqual(['řekni', 'mi', 'něco', 'o', 'teto', 'službě']);
  });

  it('--resume=<id> still extracts the chat id even when boolean-declared', () => {
    const r = parseArgv(['--resume=chat_abc', 'follow', 'up'], ['resume']);
    expect(r.flags['resume']).toBe('chat_abc');
    expect(r.positional).toEqual(['follow', 'up']);
  });
});

describe('collapseArguments', () => {
  it('returns empty for empty input', () => {
    expect(collapseArguments('')).toEqual([]);
    expect(collapseArguments(undefined)).toEqual([]);
  });

  it('tokenises with quoting', () => {
    expect(collapseArguments('--model composer "hello world"')).toEqual([
      '--model',
      'composer',
      'hello world',
    ]);
  });
});
