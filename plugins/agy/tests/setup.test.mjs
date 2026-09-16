// Integration tests for setup.mjs's `--print-models` (M1b): a family/levels
// table read from the cache, falling back to a live fetch only when there is
// no cache yet.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedModels, resetBinCache, writeModelCache } from '../scripts/lib/agy.mjs';
import { STUB_BIN } from './helpers.mjs';

const prevHome = process.env.CAD_HOME;
const prevBin = process.env.AGY_BIN;

let home;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cad-setup-'));
  process.env.CAD_HOME = home;
  process.env.AGY_BIN = STUB_BIN;
  resetBinCache();
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.CAD_HOME;
  else process.env.CAD_HOME = prevHome;
  if (prevBin === undefined) delete process.env.AGY_BIN;
  else process.env.AGY_BIN = prevBin;
  resetBinCache();
  rmSync(home, { recursive: true, force: true });
});

function captureStdout() {
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  return {
    text: () => spy.mock.calls.map((c) => c[0]).join(''),
    restore: () => spy.mockRestore(),
  };
}

describe('setup.mjs --print-models', () => {
  it('reads the cache and prints one family<TAB>levels line per family', async () => {
    writeModelCache(
      [
        { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
        { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
        { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
        { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
        { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
        { id: 'gpt-oss-120b-medium', label: 'GPT OSS 120B (Medium)' },
        { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 Thinking' },
      ],
      null,
      '1.2.2',
    );

    const { main } = await import('../scripts/setup.mjs');
    const out = captureStdout();
    const code = await main(['--print-models']);
    const text = out.text();
    out.restore();

    expect(code).toBe(0);
    expect(text).toContain('gemini-3.8-flash\tlow, medium, high');
    expect(text).toContain('gemini-3.1-pro\tlow, high');
    expect(text).toContain('gpt-oss-120b\tmedium');
    expect(text).toContain('claude-opus-4-6-thinking\tnone');
  });

  it('falls back to a live fetch when there is no cache yet, and seeds it', async () => {
    expect(cachedModels()).toBeNull();

    const { main } = await import('../scripts/setup.mjs');
    const out = captureStdout();
    const code = await main(['--print-models']);
    const text = out.text();
    out.restore();

    expect(code).toBe(0);
    // The stub's live `models` output includes these families.
    expect(text).toContain('claude-sonnet-4-6\tnone');
    expect(text).toContain('gemini-3.7-flash\tlow, medium, high');
    // The live fetch seeds the cache so the next dispatch does not pay it.
    expect(cachedModels()).not.toBeNull();
  });
});
