import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  allowModels,
  denyModels,
  readConfig,
  resolveModel,
  setDefaultModel,
  writeConfig,
} from '../scripts/lib/config.mjs';
import { configPath } from '../scripts/lib/paths.mjs';

let home;
let previous;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cod-config-'));
  previous = process.env.COD_HOME;
  process.env.COD_HOME = home;
});

afterEach(() => {
  if (previous === undefined) delete process.env.COD_HOME;
  else process.env.COD_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

describe('an absent or broken config', () => {
  it('reads as empty rather than throwing', () => {
    expect(readConfig()).toEqual({ models: [], default: null });
  });

  it('reads corrupt JSON as empty, so a dispatch is blocked and not crashed', () => {
    writeFileSync(configPath(), '{ not json', 'utf8');
    expect(readConfig()).toEqual({ models: [], default: null });
  });

  it('drops a default that is not in the list', () => {
    writeFileSync(configPath(), JSON.stringify({ models: ['a/b'], default: 'c/d' }), 'utf8');
    expect(readConfig().default).toBeNull();
  });
});

describe('allowModels', () => {
  it('makes the first model ever added the default', () => {
    expect(allowModels(['a/b'])).toEqual({ models: ['a/b'], default: 'a/b' });
  });

  it('leaves an existing default alone', () => {
    allowModels(['a/b']);
    expect(allowModels(['c/d']).default).toBe('a/b');
  });

  it('does not duplicate', () => {
    allowModels(['a/b']);
    expect(allowModels(['a/b', 'a/b']).models).toEqual(['a/b']);
  });

  it('keeps ids with slashes in the model half intact', () => {
    const id = 'nebius/deepseek-ai/DeepSeek-V4.1-Flash';
    expect(allowModels([id]).models).toEqual([id]);
  });
});

describe('denyModels', () => {
  it('clears the default rather than promoting another model', () => {
    allowModels(['a/b', 'c/d']);
    const after = denyModels(['a/b']);
    expect(after.models).toEqual(['c/d']);
    expect(after.default).toBeNull();
  });
});

describe('setDefaultModel', () => {
  it('refuses a model that is not allowed', () => {
    allowModels(['a/b']);
    expect(() => setDefaultModel('c/d')).toThrow(/not in the allowlist/);
  });
});

describe('resolveModel — the gate', () => {
  it('blocks every dispatch while the allowlist is empty', () => {
    const { model, error } = resolveModel(undefined);
    expect(model).toBeNull();
    expect(error).toMatch(/no models are allowed/);
  });

  it('blocks an explicit model that is not allowed', () => {
    allowModels(['a/b']);
    const { model, error } = resolveModel('expensive/model');
    expect(model).toBeNull();
    expect(error).toContain('expensive/model');
  });

  it('uses the default when none is named', () => {
    allowModels(['a/b', 'c/d']);
    expect(resolveModel(undefined).model).toBe('a/b');
  });

  it('uses the only allowed model when no default is set', () => {
    writeConfig({ models: ['solo/model'], default: null });
    expect(resolveModel(undefined).model).toBe('solo/model');
  });

  it('refuses to guess between several models with no default', () => {
    writeConfig({ models: ['a/b', 'c/d'], default: null });
    const { model, error } = resolveModel(undefined);
    expect(model).toBeNull();
    expect(error).toMatch(/no default model/);
  });

  it('accepts an allowed model that was asked for', () => {
    allowModels(['a/b', 'c/d']);
    expect(resolveModel('c/d')).toEqual({ model: 'c/d', error: null });
  });

  it('trims what it is given', () => {
    allowModels(['a/b']);
    expect(resolveModel('  a/b  ').model).toBe('a/b');
  });
});
