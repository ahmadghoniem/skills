import { describe, expect, it } from 'vitest';
import { collectIds, renderModels } from '../scripts/models.mjs';

const MODELS = [
  { id: 'opencode/jev-1.13-free', provider: 'opencode', free: true },
  { id: 'nebius/deepseek-ai/DeepSeek-V4.1-Flash', provider: 'nebius', free: false },
  { id: 'baseten/moonshotai/Kimi-K3', provider: 'baseten', free: false },
];

describe('collectIds', () => {
  it('is empty when the flag is absent', () => {
    expect(collectIds(undefined, [])).toEqual([]);
    expect(collectIds(false, ['stray'])).toEqual([]);
  });

  it('takes the flag value plus the bare tokens that followed it', () => {
    // `--allow a/b c/d` — parseArgv binds only the first value.
    expect(collectIds('a/b', ['c/d'])).toEqual(['a/b', 'c/d']);
  });

  it('splits a comma-separated value', () => {
    expect(collectIds('a/b,c/d', [])).toEqual(['a/b', 'c/d']);
  });

  it('trims and drops empties', () => {
    expect(collectIds(' a/b , ', [])).toEqual(['a/b']);
  });
});

describe('renderModels', () => {
  it('groups by provider in sorted order', () => {
    const out = renderModels(MODELS, { models: [], default: null });
    expect(out.indexOf('baseten:')).toBeLessThan(out.indexOf('nebius:'));
    expect(out.indexOf('nebius:')).toBeLessThan(out.indexOf('opencode:'));
  });

  it('marks free, allowed and default', () => {
    const out = renderModels(MODELS, {
      models: ['nebius/deepseek-ai/DeepSeek-V4.1-Flash'],
      default: 'nebius/deepseek-ai/DeepSeek-V4.1-Flash',
    });
    expect(out).toContain('(allowed, default)');
    expect(out).toContain('(free)');
  });

  it('says plainly that nothing can be dispatched with an empty allowlist', () => {
    expect(renderModels(MODELS, { models: [], default: null })).toContain('refuse to run');
  });

  it('names the allowlist when one exists', () => {
    const out = renderModels(MODELS, { models: ['a/b'], default: null });
    expect(out).toContain('Allowed: a/b');
    expect(out).toContain('no default set');
  });
});
