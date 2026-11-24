import { execFile } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPidGone, killTree } from '../scripts/lib/killtree.mjs';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, execFile: vi.fn() };
});

describe('killTree (Windows)', () => {
  beforeEach(() => {
    execFile.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns already-gone on exit code 128 without reading stderr, and never shells', async () => {
    execFile.mockImplementation((_file, _args, _opts, cb) => {
      const err = Object.assign(new Error('taskkill'), { code: 128 });
      // Localised stderr on purpose: the helper must not parse this text.
      cb(err, '', 'El proceso "1234" no se encontr\u00f3.');
      return { kill: vi.fn() };
    });

    expect(await killTree(1234, { graceMs: 1000 })).toBe('already-gone');
    expect(execFile.mock.calls[0][2].shell).toBe(false);
  });

  it('returns killed on a zero exit', async () => {
    execFile.mockImplementation((_file, _args, _opts, cb) => {
      cb(null, '', '');
      return { kill: vi.fn() };
    });
    expect(await killTree(99, { graceMs: 1000 })).toBe('killed');
  });
});

describe('isPidGone', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('treats EPERM as alive and only ESRCH as gone', () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = Object.assign(new Error('EPERM'), { code: 'EPERM' });
      throw err;
    });
    expect(isPidGone(4)).toBe(false);

    spy.mockImplementation(() => {
      const err = Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      throw err;
    });
    expect(isPidGone(4)).toBe(true);

    spy.mockImplementation(() => true);
    expect(isPidGone(4)).toBe(false);
  });
});
