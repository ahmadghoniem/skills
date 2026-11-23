import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildArgs,
  childEnv,
  listModels,
  parseModelList,
  resetBinCache,
  resolveBin,
  runHeadless,
  stdinLine,
} from '../scripts/lib/agy.mjs';
import { STUB_BIN, ADD_DIR_WORKS } from './helpers.mjs';

const ADD_DIR = 'C:\\Users\\Ahmed Ibrahim\\Desktop\\app';

describe('childEnv', () => {
  it('drops CLAUDECODE and turns agy auto-update off', () => {
    expect(childEnv({ CLAUDECODE: '1', PATH: 'p' })).toEqual({ PATH: 'p', AGY_CLI_DISABLE_AUTO_UPDATE: 'true' });
  });
});

describe('buildArgs', () => {
  const fresh = { addDir: ADD_DIR };

  it('fresh dispatch: --add-dir, skip-permissions, message on stdin', () => {
    const args = buildArgs({ ...fresh, model: 'gemini-3.7-flash-low' });
    expect(args[0]).toBe('--output-format');
    expect(args[1]).toBe('stream-json');
    expect(args[args.indexOf('--input-format') + 1]).toBe('stream-json');
    expect(args).toContain('--disable-slash-commands');
    expect(args).toContain('--add-dir');
    expect(args[args.indexOf('--add-dir') + 1]).toBe(ADD_DIR);
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--print-timeout');
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
    const args = buildArgs({ conversationId: 'b8b3e36f-3fb0-4d55-a0ee-8a839b4b0fe4' });
    expect(args).not.toContain('--add-dir');
    expect(args).toContain('--conversation');
    expect(args[args.indexOf('--conversation') + 1]).toBe(
      'b8b3e36f-3fb0-4d55-a0ee-8a839b4b0fe4',
    );
    expect(args).toContain('--input-format');
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
      '--model',
      '--agent',
      '--dangerously-skip-permissions',
      '--sandbox',
      '--conversation',
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
