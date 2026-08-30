import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildArgs,
  cachedModels,
  formatPrintTimeout,
  listModels,
  modelEncodesEffort,
  parseModelList,
  pickDefaultModel,
  resetBinCache,
  resolveDefaultModel,
  runHeadless,
  sidecarPrint,
  writeModelCache,
} from '../scripts/lib/agy.mjs';
import { STUB_BIN, ADD_DIR_WORKS } from './helpers.mjs';

const PROMPT = 'C:\\Users\\Ahmed Ibrahim\\.cad\\jobs\\deadbeef\\add-retry-to-fetchuser-a7f3.prompt.md';
const ADD_DIR = 'C:\\Users\\Ahmed Ibrahim\\Desktop\\app';
const LOG = 'C:\\Users\\Ahmed Ibrahim\\.cad\\jobs\\deadbeef\\add-retry-to-fetchuser-a7f3.agy.log';

describe('modelEncodesEffort', () => {
  it('is true when the slug ends in -low/-medium/-high', () => {
    expect(modelEncodesEffort('gemini-3.7-flash-low')).toBe(true);
    expect(modelEncodesEffort('gemini-3.1-pro-high')).toBe(true);
    expect(modelEncodesEffort('gpt-oss-120b-medium')).toBe(true);
  });

  it('is false when effort is not in the slug', () => {
    expect(modelEncodesEffort('claude-sonnet-4-6')).toBe(false);
    expect(modelEncodesEffort('claude-opus-4-6-thinking')).toBe(false);
    expect(modelEncodesEffort(undefined)).toBe(false);
  });
});

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
    promptPath: PROMPT,
    printTimeoutSec: 900,
    logFile: LOG,
  };

  it('fresh dispatch: --add-dir, skip-permissions, --print last', () => {
    const args = buildArgs({ ...fresh, model: 'gemini-3.7-flash-low' });
    expect(args[0]).toBe('--output-format');
    expect(args[1]).toBe('stream-json');
    expect(args).toContain('--add-dir');
    expect(args[args.indexOf('--add-dir') + 1]).toBe(ADD_DIR);
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--print-timeout');
    expect(args[args.indexOf('--print-timeout') + 1]).toBe('15m');
    expect(args[args.length - 1]).toBe(`--print=${sidecarPrint(PROMPT)}`);
    expect(args.some((a) => a === '--effort' || a.startsWith('--effort='))).toBe(false);
  });

  it('never sends --effort when the model id encodes it (F4)', () => {
    const args = buildArgs({
      ...fresh,
      model: 'gemini-3.7-flash-low',
      effort: 'high',
    });
    expect(args).not.toContain('--effort');
    expect(args).not.toContain('high');
  });

  it('sends --effort when the model id does not encode it', () => {
    const args = buildArgs({
      ...fresh,
      model: 'claude-sonnet-4-6',
      effort: 'high',
    });
    expect(args).toContain('--effort');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
  });

  it('never emits --new-project: --add-dir alone binds the cwd', () => {
    const args = buildArgs({ ...fresh, model: 'gemini-3.7-flash-high' });
    expect(args).not.toContain('--new-project');
    expect(args).toContain('--add-dir');
  });

  it('always bypasses permissions — there is no --safe and no --mode plan', () => {
    const args = buildArgs({ ...fresh, safe: true, plan: true });
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--mode');
    expect(args).not.toContain('plan');
  });

  it('passes --sandbox when asked', () => {
    const args = buildArgs({ ...fresh, sandbox: true });
    expect(args).toContain('--sandbox');
  });

  it('resume omits --add-dir, adds --conversation', () => {
    const args = buildArgs({
      promptPath: PROMPT,
      printTimeoutSec: 900,
      logFile: LOG,
      conversationId: 'b8b3e36f-3fb0-4d55-a0ee-8a839b4b0fe4',
    });
    expect(args).not.toContain('--add-dir');
    expect(args).toContain('--conversation');
    expect(args[args.indexOf('--conversation') + 1]).toBe(
      'b8b3e36f-3fb0-4d55-a0ee-8a839b4b0fe4',
    );
    expect(args[args.length - 1].startsWith('--print=')).toBe(true);
  });

  it('resume with continueLatest uses --continue, not a conversation id', () => {
    const args = buildArgs({
      promptPath: PROMPT,
      continueLatest: true,
    });
    expect(args).toContain('--continue');
    expect(args).not.toContain('--conversation');
    expect(args).not.toContain('--add-dir');
  });

  it('throws when a fresh dispatch is missing --add-dir', () => {
    expect(() => buildArgs({ promptPath: PROMPT })).toThrow(/--add-dir/);
  });

  it('only emits flags from the 1.1.19 surface', () => {
    const args = buildArgs({
      ...fresh,
      model: 'claude-sonnet-4-6',
      effort: 'medium',
      sandbox: true,
    });
    const allowed = new Set([
      '--output-format',
      '--add-dir',
      '--print-timeout',
      '--log-file',
      '--model',
      '--effort',
      '--dangerously-skip-permissions',
      '--sandbox',
      '--print',
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

describe('pickDefaultModel', () => {
  const list = [
    { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
    { id: 'gemini-3.1-flash-high', label: 'Gemini 3.1 Flash (High)' },
    { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
    { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
    { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
    { id: 'gemini-3.7-pro-high', label: 'Gemini 3.7 Pro (High)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  ];

  it('picks the newest flash at medium when the caller says nothing', () => {
    expect(pickDefaultModel(list)).toBe('gemini-3.7-flash-medium');
  });

  it('honours the requested effort within the newest flash version', () => {
    expect(pickDefaultModel(list, null, 'low')).toBe('gemini-3.7-flash-low');
    expect(pickDefaultModel(list, null, 'medium')).toBe('gemini-3.7-flash-medium');
    expect(pickDefaultModel(list, null, 'high')).toBe('gemini-3.7-flash-high');
  });

  it('never drops to an older version to satisfy the effort', () => {
    // 3.1 offers high and 3.7 does not; the newer version still wins.
    const gapped = [
      { id: 'gemini-3.1-flash-high', label: 'a' },
      { id: 'gemini-3.7-flash-low', label: 'b' },
    ];
    expect(pickDefaultModel(gapped, null, 'high')).toBe('gemini-3.7-flash-low');
  });

  it('prefers a newer flash over an older one even at higher effort', () => {
    const older = [
      { id: 'gemini-3.1-flash-high', label: 'a' },
      { id: 'gemini-3.7-flash-low', label: 'b' },
    ];
    expect(pickDefaultModel(older)).toBe('gemini-3.7-flash-low');
  });

  it('falls back to the account default when nothing is flash', () => {
    const noFlash = [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
    ];
    expect(pickDefaultModel(noFlash, 'Claude Opus 4.6 (Thinking)')).toBe(
      'claude-opus-4-6-thinking',
    );
  });

  it('falls back to the first model when there is no flash and no default', () => {
    expect(pickDefaultModel([{ id: 'claude-sonnet-4-6', label: 'x' }])).toBe('claude-sonnet-4-6');
  });

  it('returns null for an empty list rather than inventing an id', () => {
    expect(pickDefaultModel([])).toBe(null);
    expect(pickDefaultModel(undefined)).toBe(null);
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

  it('runHeadless replays a fixture and captures NDJSON', async () => {
    process.env.AGY_BIN = STUB_BIN;
    process.env.AGY_STUB_FIXTURE = ADD_DIR_WORKS;
    resetBinCache();
    const dir = mkdtempSync(join(tmpdir(), 'cad-spawn-'));
    dirs.push(dir);
    const logPath = join(dir, 'run.ndjson');
    const result = await runHeadless({
      args: ['--output-format', 'stream-json'],
      logPath,
      timeoutSec: 10,
    });
    expect(result.killed).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.events.some((e) => e.event === 'result')).toBe(true);
    const logged = readFileSync(logPath, 'utf8');
    expect(logged).toContain('"event":"init"');
    expect(logged).toContain('"event":"result"');
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
    // The whole point: a cold cache costs nothing and yields no --model, which
    // lets agy fall back to the account default on its own.
    expect(resolveDefaultModel()).toBeNull();
  });

  it('round-trips a written list and auto-picks the newest flash from it', () => {
    freshHome();
    writeModelCache(
      [
        { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro' },
        { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash' },
        { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash Low' },
      ],
      'Gemini 3.1 Pro',
    );
    expect(cachedModels()).toHaveLength(3);
    expect(resolveDefaultModel()).toBe('gemini-3.7-flash-high');
  });

  it('survives a corrupt cache file without throwing', () => {
    const dir = freshHome();
    writeFileSync(join(dir, 'models.json'), '{ not json', 'utf8');
    expect(cachedModels()).toBeNull();
    expect(resolveDefaultModel()).toBeNull();
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
    expect(resolveDefaultModel()).toBe('gemini-3.7-flash-high');
  });
});
