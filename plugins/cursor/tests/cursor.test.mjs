import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HAPPY_FIXTURE, STUB_BIN, makeTempHome } from './helpers.mjs';

// Captured from `cursor-agent models` on 2026.10.22-27dcf5f, shortened.
const REAL_MODELS_STDOUT = [
  'Available models',
  '',
  'auto - Auto (current, default)',
  'composer-2.5 - Composer 2.5',
  'gpt-5.3-codex - Codex 5.3',
  '',
  'Tip: use --model <id> to switch.',
  '',
].join('\n');

describe('parseModelList', () => {
  it('keeps id and label and drops headings and tips', async () => {
    const { parseModelList } = await import('../scripts/lib/cursor.mjs');
    expect(parseModelList(REAL_MODELS_STDOUT)).toEqual([
      { id: 'auto', label: 'Auto (current, default)' },
      { id: 'composer-2.5', label: 'Composer 2.5' },
      { id: 'gpt-5.3-codex', label: 'Codex 5.3' },
    ]);
  });
});

describe('parseVersion', () => {
  it('reads the date-stamped version out of `cursor-agent --version`', async () => {
    const { parseVersion } = await import('../scripts/lib/cursor.mjs');
    expect(parseVersion('2026.10.22-27dcf5f\n')).toBe('2026.10.22-27dcf5f');
    expect(parseVersion('cursor-agent 2026.1.5-abc123')).toBe('2026.1.5-abc123');
    expect(parseVersion('no version here')).toBeNull();
  });
});

describe('buildArgs', () => {
  it('runs headless with stream-json, --force and no auto-update', async () => {
    const { buildArgs } = await import('../scripts/lib/cursor.mjs');
    const args = buildArgs({ prompt: 'do it' });
    expect(args.slice(0, 5)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--force',
      '--disable-auto-update',
    ]);
    expect(args.slice(-2)).toEqual(['--', 'do it']);
  });

  it('passes no --model unless one was named', async () => {
    const { buildArgs } = await import('../scripts/lib/cursor.mjs');
    expect(buildArgs({ prompt: 'x' })).not.toContain('--model');
    const named = buildArgs({ prompt: 'x', model: 'auto' });
    expect(named[named.indexOf('--model') + 1]).toBe('auto');
  });

  it('never passes --trust, --approve-mcps or --continue', async () => {
    const { buildArgs } = await import('../scripts/lib/cursor.mjs');
    for (const args of [
      buildArgs({ prompt: 'x' }),
      buildArgs({ prompt: 'x', chatId: '11111111-2222-3333-4444-555555555555' }),
      buildArgs({ prompt: 'x', resumeChatId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
    ]) {
      expect(args).not.toContain('--trust');
      expect(args).not.toContain('--approve-mcps');
      expect(args).not.toContain('--continue');
    }
  });

  it('names a fresh chat with --new-session-id', async () => {
    const { buildArgs } = await import('../scripts/lib/cursor.mjs');
    const args = buildArgs({ prompt: 'x', chatId: '11111111-2222-3333-4444-555555555555' });
    expect(args[args.indexOf('--new-session-id') + 1]).toBe('11111111-2222-3333-4444-555555555555');
    expect(args).not.toContain('--resume');
  });

  it('resumes a named chat and does not also name a new one', async () => {
    const { buildArgs } = await import('../scripts/lib/cursor.mjs');
    const args = buildArgs({
      prompt: 'x',
      chatId: '11111111-2222-3333-4444-555555555555',
      resumeChatId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    expect(args[args.indexOf('--resume') + 1]).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(args).not.toContain('--new-session-id');
  });

  it('keeps a brief that starts with a dash after --', async () => {
    const { buildArgs } = await import('../scripts/lib/cursor.mjs');
    const args = buildArgs({ prompt: '--- a front-matter brief' });
    expect(args[args.length - 2]).toBe('--');
    expect(args[args.length - 1]).toBe('--- a front-matter brief');
  });
});

describe('promptArg', () => {
  it('inlines a brief up to the limit and points to the file past it', async () => {
    const { PROMPT_INLINE_MAX, promptArg } = await import('../scripts/lib/cursor.mjs');
    expect(promptArg('short', '/tmp/p.txt')).toBe('short');
    const long = 'x'.repeat(PROMPT_INLINE_MAX + 1);
    expect(promptArg(long, '/tmp/p.txt')).toContain('/tmp/p.txt');
  });
});

describe('resolveBin', () => {
  let tmp;
  const saved = {};
  const KEYS = ['CURSOR_AGENT_BIN', 'LOCALAPPDATA', 'PATH', 'Path'];

  beforeEach(() => {
    tmp = makeTempHome();
    for (const k of KEYS) saved[k] = process.env[k];
    delete process.env.CURSOR_AGENT_BIN;
    process.env.LOCALAPPDATA = join(tmp.dir, 'localappdata');
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    tmp.cleanup();
  });

  /** A PATH holding only `dir` plus the folder `where`/`which` live in. */
  function onlyOnPath(dir) {
    const system =
      process.platform === 'win32'
        ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32')
        : ['/usr/bin', '/bin'].join(delimiter);
    const value = [dir, system].join(delimiter);
    process.env.PATH = value;
    if (process.platform === 'win32') process.env.Path = value;
  }

  it('prefers CURSOR_AGENT_BIN', async () => {
    process.env.CURSOR_AGENT_BIN = STUB_BIN;
    const { resolveBin } = await import('../scripts/lib/cursor.mjs');
    expect(await resolveBin()).toBe(STUB_BIN);
  });

  it.runIf(process.platform === 'win32')('uses the installer path before PATH', async () => {
    const dir = join(process.env.LOCALAPPDATA, 'cursor-agent');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'cursor-agent.cmd'), '@echo off\r\n');
    const pathDir = join(tmp.dir, 'bin');
    mkdirSync(pathDir);
    writeFileSync(join(pathDir, 'cursor-agent.cmd'), '@echo off\r\n');
    onlyOnPath(pathDir);
    const { resolveBin } = await import('../scripts/lib/cursor.mjs');
    expect(await resolveBin()).toBe(join(dir, 'cursor-agent.cmd'));
  });

  it('finds cursor-agent on PATH', async () => {
    const pathDir = join(tmp.dir, 'bin');
    mkdirSync(pathDir);
    const name = process.platform === 'win32' ? 'cursor-agent.cmd' : 'cursor-agent';
    writeFileSync(join(pathDir, name), process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', {
      mode: 0o755,
    });
    onlyOnPath(pathDir);
    const { resolveBin } = await import('../scripts/lib/cursor.mjs');
    expect((await resolveBin()).toLowerCase()).toBe(join(pathDir, name).toLowerCase());
  });

  // Grok Build also installs an `agent` binary; the bare name is never used.
  it('never picks an `agent` binary on PATH', async () => {
    const pathDir = join(tmp.dir, 'bin');
    mkdirSync(pathDir);
    for (const name of ['agent', 'agent.cmd', 'agent.exe']) {
      writeFileSync(join(pathDir, name), '', { mode: 0o755 });
    }
    onlyOnPath(pathDir);
    const { resolveBin } = await import('../scripts/lib/cursor.mjs');
    await expect(resolveBin()).rejects.toThrow(/cursor-agent not found/);
  });
});

describe('escalateSigkill', () => {
  it('sends SIGKILL to a child that has not exited', async () => {
    const { escalateSigkill } = await import('../scripts/lib/cursor.mjs');
    const child = { killed: true, exitCode: null, signalCode: null, kill: vi.fn() };
    escalateSigkill(child);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('leaves an exited child alone', async () => {
    const { escalateSigkill } = await import('../scripts/lib/cursor.mjs');
    const child = { killed: true, exitCode: 1, signalCode: null, kill: vi.fn() };
    escalateSigkill(child);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe('runHome', () => {
  let tmp;
  let saved;

  beforeEach(() => {
    tmp = makeTempHome();
    saved = process.env.CCD_HOME;
    process.env.CCD_HOME = join(tmp.dir, 'ccd');
    vi.resetModules();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.CCD_HOME;
    else process.env.CCD_HOME = saved;
    tmp.cleanup();
  });

  it('copies only the Cursor config and .gitconfig into the run home', async () => {
    const { runHome } = await import('../scripts/lib/cursor.mjs');
    const real = join(tmp.dir, 'real');
    mkdirSync(join(real, '.cursor'), { recursive: true });
    mkdirSync(join(real, '.claude'), { recursive: true });
    writeFileSync(join(real, '.cursor', 'cli-config.json'), '{"model":"x"}');
    writeFileSync(join(real, '.gitconfig'), '[user]\n');
    writeFileSync(join(real, '.claude', 'CLAUDE.md'), 'rules');
    const home = runHome(real);
    expect(home).toBe(join(tmp.dir, 'ccd', 'cursor-home'));
    expect(readFileSync(join(home, '.cursor', 'cli-config.json'), 'utf8')).toBe('{"model":"x"}');
    expect(readFileSync(join(home, '.gitconfig'), 'utf8')).toBe('[user]\n');
    expect(() => readFileSync(join(home, '.claude', 'CLAUDE.md'))).toThrow();
  });

  it('works when the user has neither file', async () => {
    const { runHome } = await import('../scripts/lib/cursor.mjs');
    const home = runHome(join(tmp.dir, 'empty'));
    expect(() => readFileSync(join(home, '.gitconfig'))).toThrow();
  });
});

describe('runHeadless against the stub', () => {
  let tmp;
  const saved = {};
  const KEYS = ['CCD_HOME', 'CURSOR_AGENT_BIN', 'CURSOR_AGENT_STUB_FIXTURE', 'CURSOR_AGENT_STUB_ARGV_OUT'];

  beforeEach(() => {
    tmp = makeTempHome();
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.CCD_HOME = tmp.dir;
    process.env.CURSOR_AGENT_BIN = STUB_BIN;
    process.env.CURSOR_AGENT_STUB_FIXTURE = HAPPY_FIXTURE;
    process.env.CURSOR_AGENT_STUB_ARGV_OUT = join(tmp.dir, 'argv.json');
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    tmp.cleanup();
  });

  it('streams events, writes the log and the prompt file, and keeps the chat id', async () => {
    const { runHeadless } = await import('../scripts/lib/cursor.mjs');
    const { summariseEvents } = await import('../scripts/lib/parse.mjs');
    const logPath = join(tmp.dir, 'run.ndjson');
    const chatId = '11111111-2222-3333-4444-555555555555';
    const onSpawn = vi.fn();
    const result = await runHeadless({ prompt: 'hi', chatId, logPath, onSpawn });
    expect(result.exitCode).toBe(0);
    expect(result.killed).toBe(false);
    expect(onSpawn).toHaveBeenCalledWith(expect.any(Number));
    expect(readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length).toBeGreaterThan(0);
    expect(readFileSync(`${logPath}.prompt.txt`, 'utf8')).toBe('hi');
    const summary = summariseEvents(result.events);
    expect(summary.success).toBe(true);
    expect(summary.sessionId).toBe(chatId);
    const argv = JSON.parse(readFileSync(process.env.CURSOR_AGENT_STUB_ARGV_OUT, 'utf8'));
    expect(argv).toContain('--new-session-id');
    expect(argv).not.toContain('--model');
  });

  it('keeps the stderr tail of a refused run', async () => {
    process.env.CURSOR_AGENT_STUB_STDERR =
      'ActionRequiredError: Named models unavailable Free plans can only use Auto.';
    process.env.CURSOR_AGENT_STUB_EXIT = '1';
    try {
      const { runHeadless } = await import('../scripts/lib/cursor.mjs');
      const result = await runHeadless({ prompt: 'hi', logPath: join(tmp.dir, 'r.ndjson') });
      expect(result.exitCode).toBe(1);
      expect(result.stderrTail.join('\n')).toContain('Named models unavailable');
    } finally {
      delete process.env.CURSOR_AGENT_STUB_STDERR;
      delete process.env.CURSOR_AGENT_STUB_EXIT;
    }
  });
});
