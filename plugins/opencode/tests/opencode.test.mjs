import { describe, expect, it } from 'vitest';
import { buildArgs, needsShell, parseModelList } from '../scripts/lib/opencode.mjs';

const BRIEF = 'C:/Users/x/.cod/jobs/abc/task.prompt.md';

describe('buildArgs', () => {
  it('refuses to build without a model — the gate has no bypass', () => {
    expect(() => buildArgs({ promptPath: BRIEF })).toThrow(/model id is required/);
  });

  it('refuses to build without a brief', () => {
    expect(() => buildArgs({ model: 'a/b' })).toThrow(/prompt file path is required/);
  });

  it('always asks for JSON events and always passes --auto', () => {
    const args = buildArgs({ promptPath: BRIEF, model: 'a/b' });
    expect(args.slice(0, 6)).toEqual(['run', '--format', 'json', '--auto', '--model', 'a/b']);
  });

  it('separates the message from -f with --, or opencode reads it as a filename', () => {
    // `-f` is a yargs array flag: without the separator it eats the message
    // and opencode dies with `File not found: <the message>`. Regression
    // guard for a bug this plugin shipped with once.
    const args = buildArgs({ promptPath: BRIEF, model: 'a/b', title: 'rename things' });
    const f = args.indexOf('-f');
    expect(args[f + 1]).toBe(BRIEF);
    expect(args[f + 2]).toBe('--');
    expect(f + 3).toBe(args.length - 1);
    expect(args.at(-1)).toContain('attached file');
  });

  it('carries the optional flags through', () => {
    const args = buildArgs({
      promptPath: BRIEF,
      model: 'a/b',
      variant: 'high',
      dir: 'C:/repo',
      title: 't',
    });
    expect(args).toContain('--variant');
    expect(args[args.indexOf('--variant') + 1]).toBe('high');
    expect(args[args.indexOf('--dir') + 1]).toBe('C:/repo');
    expect(args[args.indexOf('--title') + 1]).toBe('t');
  });

  it('omits every optional flag that was not asked for', () => {
    const args = buildArgs({ promptPath: BRIEF, model: 'a/b' });
    for (const flag of ['--variant', '--dir', '--session', '--continue', '--fork', '--title']) {
      expect(args).not.toContain(flag);
    }
  });

  it('resumes a named session', () => {
    const args = buildArgs({ promptPath: BRIEF, model: 'a/b', sessionId: 'ses_x' });
    expect(args[args.indexOf('--session') + 1]).toBe('ses_x');
    expect(args).not.toContain('--continue');
  });

  it('prefers an explicit session over --continue', () => {
    const args = buildArgs({
      promptPath: BRIEF,
      model: 'a/b',
      sessionId: 'ses_x',
      continueLatest: true,
    });
    expect(args).toContain('--session');
    expect(args).not.toContain('--continue');
  });

  it('only forks a run that is resuming something', () => {
    expect(buildArgs({ promptPath: BRIEF, model: 'a/b', fork: true })).not.toContain('--fork');
    expect(
      buildArgs({ promptPath: BRIEF, model: 'a/b', sessionId: 'ses_x', fork: true }),
    ).toContain('--fork');
  });
});

describe('parseModelList', () => {
  it('splits the provider off the first slash only', () => {
    const models = parseModelList('nebius/deepseek-ai/DeepSeek-V4.1-Flash\n');
    expect(models).toEqual([
      {
        id: 'nebius/deepseek-ai/DeepSeek-V4.1-Flash',
        provider: 'nebius',
        free: false,
      },
    ]);
  });

  it('marks the -free ids', () => {
    const models = parseModelList('opencode/jev-1.13-free\nopencode/big-pickle\n');
    expect(models.map((m) => m.free)).toEqual([true, false]);
  });

  it('skips banners, blank lines and anything without a slash', () => {
    const models = parseModelList('\n  \nWelcome to opencode\nheader line\na/b\n');
    expect(models.map((m) => m.id)).toEqual(['a/b']);
  });

  it('dedupes', () => {
    expect(parseModelList('a/b\na/b\n')).toHaveLength(1);
  });

  it('is empty for empty input', () => {
    expect(parseModelList('')).toEqual([]);
    expect(parseModelList(null)).toEqual([]);
  });
});

describe('needsShell', () => {
  it('is false for a real executable', () => {
    expect(needsShell('C:/Users/x/.bun/bin/opencode.exe')).toBe(false);
  });

  it('is false off Windows whatever the extension', () => {
    // The check is platform-gated, so on a POSIX runner every answer is false.
    if (process.platform !== 'win32') {
      expect(needsShell('/usr/local/bin/opencode.cmd')).toBe(false);
    } else {
      expect(needsShell('C:/npm/opencode.cmd')).toBe(true);
      expect(needsShell('C:/npm/opencode.BAT')).toBe(true);
    }
  });

  it('handles junk without throwing', () => {
    expect(needsShell(undefined)).toBe(false);
  });
});
