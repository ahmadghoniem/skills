import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildArgs,
  cachedModels,
  formatPrintTimeout,
  listModels,
  modelCacheStale,
  parseModelList,
  resetBinCache,
  resolveBin,
  runHeadless,
  stdinLine,
  writeModelCache,
} from '../scripts/lib/agy.mjs';
import { STUB_BIN, ADD_DIR_WORKS } from './helpers.mjs';

const ADD_DIR = 'C:\\Users\\Ahmed Ibrahim\\Desktop\\app';
const LOG = 'C:\\Users\\Ahmed Ibrahim\\.cad\\jobs\\deadbeef\\add-retry-to-fetchuser-a7f3.agy.log';

describe('formatPrintTimeout', () => {
  it('emits Go durations', () => {
    expect(formatPrintTimeout(900)).toBe('15m');
    expect(formatPrintTimeout(120)).toBe('2m');
    expect(formatPrintTimeout(90)).toBe('1m30s');
    expect(formatPrintTimeout(45)).toBe('45s');
  });
});

describe('buildArgs', () => {
  const fresh = {
    addDir: ADD_DIR,
    printTimeoutSec: 900,
    logFile: LOG,
  };

  it('fresh dispatch: --add-dir, skip-permissions, message on stdin', () => {
    const args = buildArgs({ ...fresh, model: 'gemini-3.7-flash-low' });
    expect(args[0]).toBe('--output-format');
    expect(args[1]).toBe('stream-json');
    expect(args[args.indexOf('--input-format') + 1]).toBe('stream-json');
    expect(args).toContain('--disable-slash-commands');
    expect(args).toContain('--add-dir');
    expect(args[args.indexOf('--add-dir') + 1]).toBe(ADD_DIR);
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--print-timeout');
    expect(args[args.indexOf('--print-timeout') + 1]).toBe('15m');
    expect(args.some((a) => a.startsWith('--print='))).toBe(false);
    expect(args.some((a) => a === '--effort' || a.startsWith('--effort='))).toBe(false);
  });

  it('never emits --new-project: --add-dir alone binds the cwd', () => {
    const args = buildArgs({ ...fresh, model: 'gemini-3.7-flash-high' });
    expect(args).not.toContain('--new-project');
    expect(args).toContain('--add-dir');
  });

  it('passes --sandbox when asked', () => {
    const args = buildArgs({ ...fresh, sandbox: true });
    expect(args).toContain('--sandbox');
  });

  it('resume omits --add-dir, adds --conversation', () => {
    const args = buildArgs({
      printTimeoutSec: 900,
      logFile: LOG,
      conversationId: 'b8b3e36f-3fb0-4d55-a0ee-8a839b4b0fe4',
    });
    expect(args).not.toContain('--add-dir');
    expect(args).toContain('--conversation');
    expect(args[args.indexOf('--conversation') + 1]).toBe(
      'b8b3e36f-3fb0-4d55-a0ee-8a839b4b0fe4',
    );
    expect(args).toContain('--input-format');
  });

  it('resume with continueLatest uses --continue, not a conversation id', () => {
    const args = buildArgs({
      continueLatest: true,
    });
    expect(args).toContain('--continue');
    expect(args).not.toContain('--conversation');
    expect(args).not.toContain('--add-dir');
  });

  it('throws when a fresh dispatch is missing --add-dir', () => {
    expect(() => buildArgs({})).toThrow(/--add-dir/);
  });

  it('only emits flags from the 1.2.11 surface', () => {
    const args = buildArgs({
      ...fresh,
      model: 'claude-sonnet-4-6',
      sandbox: true,
    });
    const allowed = new Set([
      '--output-format',
      '--input-format',
      '--disable-slash-commands',
      '--add-dir',
      '--print-timeout',
      '--log-file',
      '--model',
      '--dangerously-skip-permissions',
      '--sandbox',
      '--conversation',
      '--continue',
    ]);
    for (const tok of args) {
      if (!tok.startsWith('--')) continue;
      const flag = tok.split('=')[0];
      expect(allowed.has(flag)).toBe(true);
    }
  });
});

describe('parseModelList', () => {
  it('parses TSV of id then label', () => {
    const list = parseModelList(
      'gemini-3.7-flash-high\tGemini 3.7 Flash (High)\nclaude-sonnet-4-6\tClaude Sonnet 4.6\n',
    );
    expect(list).toEqual([
      { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ]);
  });
});

describe('stubbed spawn (never the real binary)', () => {
  const prevBin = process.env.AGY_BIN;
  const prevFixture = process.env.AGY_STUB_FIXTURE;
  const dirs = [];

  afterEach(() => {
    if (prevBin === undefined) delete process.env.AGY_BIN;
    else process.env.AGY_BIN = prevBin;
    if (prevFixture === undefined) delete process.env.AGY_STUB_FIXTURE;
    else process.env.AGY_STUB_FIXTURE = prevFixture;
    resetBinCache();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('listModels reads TSV from the stub', async () => {
    process.env.AGY_BIN = STUB_BIN;
    resetBinCache();
    const models = await listModels();
    expect(models.map((m) => m.id)).toContain('gemini-3.7-flash-high');
    expect(models.map((m) => m.id)).toContain('claude-sonnet-4-6');
  });

  it('listModels throws on a failed fetch instead of returning an empty list', async () => {
    process.env.AGY_BIN = STUB_BIN;
    process.env.AGY_STUB_FAIL = '1';
    resetBinCache();
    try {
      await expect(listModels()).rejects.toThrow(/agy models failed: stub: forced failure/);
    } finally {
      delete process.env.AGY_STUB_FAIL;
    }
  });

  it('runHeadless replays a fixture and parses its events', async () => {
    process.env.AGY_BIN = STUB_BIN;
    process.env.AGY_STUB_FIXTURE = ADD_DIR_WORKS;
    resetBinCache();
    const result = await runHeadless({
      args: ['--output-format', 'stream-json'],
    });
    expect(result.exitCode).toBe(0);
    expect(result.events.some((e) => e.event === 'init')).toBe(true);
    expect(result.events.some((e) => e.event === 'result')).toBe(true);
  });
});

describe('model cache', () => {
  const prevHome = process.env.CAD_HOME;
  /** @type {string[]} */
  const dirs = [];

  function freshHome() {
    const dir = mkdtempSync(join(tmpdir(), 'cad-models-'));
    dirs.push(dir);
    process.env.CAD_HOME = dir;
    return dir;
  }

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CAD_HOME;
    else process.env.CAD_HOME = prevHome;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('returns null on a cold cache instead of fetching', () => {
    freshHome();
    expect(cachedModels()).toBeNull();
  });

  it('round-trips a written list', () => {
    freshHome();
    writeModelCache(
      [
        { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro' },
        { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash' },
        { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash Low' },
      ],
      '1.5.7',
    );
    expect(cachedModels()).toHaveLength(3);
  });

  it('survives a corrupt cache file without throwing', () => {
    const dir = freshHome();
    writeFileSync(join(dir, 'models.json'), '{ not json', 'utf8');
    expect(cachedModels()).toBeNull();
  });

  it('never expires on its own — a stale timestamp is still served', () => {
    const dir = freshHome();
    // Time-based invalidation would make some unpredictable dispatch pay the
    // ~2s fetch. Refreshing is an explicit act (`/agy:setup`), so an old
    // fetchedAt must change nothing.
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        fetchedAt: '2019-01-01T00:00:00.000Z',
        models: [{ id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash' }],
      }),
      'utf8',
    );
    expect(cachedModels()).toHaveLength(1);
  });
});

describe('modelCacheStale', () => {
  const prevHome = process.env.CAD_HOME;
  /** @type {string[]} */
  const dirs = [];

  function freshHome() {
    const dir = mkdtempSync(join(tmpdir(), 'cad-stale-'));
    dirs.push(dir);
    process.env.CAD_HOME = dir;
    return dir;
  }

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CAD_HOME;
    else process.env.CAD_HOME = prevHome;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('stale when there is no cache at all', () => {
    freshHome();
    expect(modelCacheStale()).toBe(true);
  });

  it('not stale just after a write', () => {
    freshHome();
    writeModelCache([{ id: 'gemini-3.8-flash-high', label: 'a' }], null);
    expect(modelCacheStale()).toBe(false);
  });

  it('stale once fetchedAt is older than 7 days', () => {
    const dir = freshHome();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({ fetchedAt: eightDaysAgo, models: [] }),
      'utf8',
    );
    expect(modelCacheStale()).toBe(true);
  });

  it('not stale just inside 7 days', () => {
    const dir = freshHome();
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({ fetchedAt: sixDaysAgo, models: [] }),
      'utf8',
    );
    expect(modelCacheStale()).toBe(false);
  });
});

describe('resolveBin: cached path (T1, "store the resolved path")', () => {
  const prevBin = process.env.AGY_BIN;
  const prevHome = process.env.CAD_HOME;
  /** @type {string[]} */
  const dirs = [];

  afterEach(() => {
    if (prevBin === undefined) delete process.env.AGY_BIN;
    else process.env.AGY_BIN = prevBin;
    if (prevHome === undefined) delete process.env.CAD_HOME;
    else process.env.CAD_HOME = prevHome;
    resetBinCache();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('uses the cached bin path when it still exists, skipping `where`', async () => {
    delete process.env.AGY_BIN;
    const dir = mkdtempSync(join(tmpdir(), 'cad-bin-'));
    dirs.push(dir);
    process.env.CAD_HOME = dir;
    writeModelCache([{ id: 'gemini-3.8-flash-high', label: 'a' }], null, STUB_BIN);
    resetBinCache();
    const bin = await resolveBin();
    expect(bin).toBe(STUB_BIN);
  });

  it('ignores a cached bin path that no longer exists on disk', async () => {
    delete process.env.AGY_BIN;
    const dir = mkdtempSync(join(tmpdir(), 'cad-bin-'));
    dirs.push(dir);
    process.env.CAD_HOME = dir;
    writeModelCache(
      [{ id: 'gemini-3.8-flash-high', label: 'a' }],
      null,
      join(dir, 'nonexistent-agy.exe'),
    );
    resetBinCache();
    // Throws on a machine with no agy installed, which also skips the stale path.
    const bin = await resolveBin().catch(() => null);
    expect(bin).not.toBe(join(dir, 'nonexistent-agy.exe'));
  });
});

describe('buildArgs: custom agent', () => {
  const fresh = { addDir: ADD_DIR };

  it('passes --agent on a fresh dispatch', () => {
    const args = buildArgs({ ...fresh, agent: 'bash-delegate' });
    expect(args[args.indexOf('--agent') + 1]).toBe('bash-delegate');
  });

  // A resumed conversation keeps the agent it started with.
  it('drops --agent on resume', () => {
    const args = buildArgs({ conversationId: 'abc', agent: 'bash-delegate' });
    expect(args).not.toContain('--agent');
  });
});

describe('stdinLine', () => {
  it('is one JSON line that keeps newlines and quotes in the text', () => {
    const line = stdinLine('a "b"\nc');
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({ event: 'user', message: { content: 'a "b"\nc' } });
  });
});
