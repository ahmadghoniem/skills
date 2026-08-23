import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPidGone, killTree } from '../scripts/lib/killtree.mjs';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, execFile: vi.fn() };
});

describe('killTree (Windows)', () => {
  beforeEach(() => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
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

    const result = await killTree(1234, { graceMs: 1000 });
    expect(result).toBe('already-gone');
    expect(execFile).toHaveBeenCalledTimes(1);
    const [file, args, opts] = execFile.mock.calls[0];
    expect(file).toBe(join(process.env.WINDIR || 'C:\\Windows', 'System32', 'taskkill.exe'));
    expect(args).toEqual(['/PID', '1234', '/T', '/F']);
    expect(opts.shell).toBe(false);
    expect(opts.windowsHide).toBe(true);
    expect(opts.env.MSYS_NO_PATHCONV).toBe('1');
  });

  it('returns killed on a zero exit and still forces shell: false', async () => {
    execFile.mockImplementation((_file, _args, _opts, cb) => {
      cb(null, '', '');
      return { kill: vi.fn() };
    });
    const result = await killTree(99, { graceMs: 1000 });
    expect(result).toBe('killed');
    expect(execFile.mock.calls[0][2].shell).toBe(false);
  });
});

describe('killTree (POSIX)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('signals the process group and escalates to SIGKILL if SIGTERM does not reap', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    let alive = true;
    const spy = vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (sig === 0) {
        if (alive) return true;
        const err = Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
        throw err;
      }
      if (pid === -77 && sig === 'SIGKILL') {
        alive = false;
        return true;
      }
      return true;
    });

    const result = await killTree(77, { graceMs: 80 });
    expect(spy).toHaveBeenCalledWith(-77, 'SIGTERM');
    expect(spy).toHaveBeenCalledWith(-77, 'SIGKILL');
    expect(result).toBe('killed');
  });

  it('returns already-gone when the group is missing (ESRCH)', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      throw err;
    });
    expect(await killTree(88, { graceMs: 50 })).toBe('already-gone');
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
