// Tests for setup.mjs: `--print-models` reads model ids from the cache,
// falling back to a live fetch only when there is no cache yet; `versionOk`
// checks the minimum agy version.
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
  it('reads the cache and prints one id per line', async () => {
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
      '1.2.2',
    );

    const { main } = await import('../scripts/setup.mjs');
    const out = captureStdout();
    const code = await main(['--print-models']);
    const text = out.text();
    out.restore();

    expect(code).toBe(0);
    expect(text.split('\n').filter(Boolean)).toEqual([
      'gemini-3.8-flash-high',
      'gemini-3.8-flash-medium',
      'gemini-3.8-flash-low',
      'gemini-3.1-pro-high',
      'gemini-3.1-pro-low',
      'gpt-oss-120b-medium',
      'claude-opus-4-6-thinking',
    ]);
  });

  it('falls back to a live fetch when there is no cache yet, and seeds it', async () => {
    expect(cachedModels()).toBeNull();

    const { main } = await import('../scripts/setup.mjs');
    const out = captureStdout();
    const code = await main(['--print-models']);
    const text = out.text();
    out.restore();

    expect(code).toBe(0);
    // The stub's live `models` output includes these ids.
    expect(text).toContain('claude-sonnet-4-6\n');
    expect(text).toContain('gemini-3.7-flash-low\n');
    // The live fetch seeds the cache so the next dispatch does not pay it.
    expect(cachedModels()).not.toBeNull();
  });
});

describe('setup.mjs versionOk', () => {
  it('passes the minimum and newer, fails older, and passes text with no version', async () => {
    const { versionOk } = await import('../scripts/setup.mjs');
    expect(versionOk('1.5.8', '1.5.8')).toBe(true);
    expect(versionOk('agy 1.5.10', '1.5.8')).toBe(true);
    expect(versionOk('1.5.7', '1.5.8')).toBe(false);
    expect(versionOk('(no output)', '1.5.8')).toBe(true);
  });
});
