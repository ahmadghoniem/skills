import { afterEach, describe, expect, it } from 'vitest';
import { buildArgs, listModels } from '../scripts/lib/agy.mjs';
import { STUB_BIN } from './helpers.mjs';

describe('buildArgs', () => {
  it('talks to agy in stream-json both ways, with slash commands off', () => {
    const args = buildArgs({ addDir: 'C:/repo' });
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args[args.indexOf('--input-format') + 1]).toBe('stream-json');
    expect(args).toContain('--disable-slash-commands');
  });

  it('passes --sandbox when asked', () => {
    expect(buildArgs({ addDir: 'C:/repo', sandbox: true })).toContain('--sandbox');
  });
});

describe('listModels', () => {
  const prevBin = process.env.AGY_BIN;
  afterEach(() => {
    if (prevBin === undefined) delete process.env.AGY_BIN;
    else process.env.AGY_BIN = prevBin;
    delete process.env.AGY_STUB_FAIL;
  });

  it('throws on a failed fetch instead of returning an empty list', async () => {
    process.env.AGY_BIN = STUB_BIN;
    process.env.AGY_STUB_FAIL = '1';
    await expect(listModels()).rejects.toThrow(/agy models failed: stub: forced failure/);
  });
});
