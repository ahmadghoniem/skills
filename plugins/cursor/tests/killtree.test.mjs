import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPidGone, killTree } from '../scripts/lib/killtree.mjs';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, execFile: vi.fn() };
});

function withPlatform(value) {
  const desc = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { configurable: true, value });
  return () => {
    if (desc) Object.defineProperty(process, 'platform', desc);
  };
}

describe('isPidGone', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('treats EPERM as alive', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = /** @type {NodeJS.ErrnoException} */ (new Error('EPERM'));
      err.code = 'EPERM';
      throw err;
    });
    expect(isPidGone(1)).toBe(false);
  });

  it('treats only ESRCH as gone', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = /** @type {NodeJS.ErrnoException} */ (new Error('ESRCH'));
      err.code = 'ESRCH';
      throw err;
    });
    expect(isPidGone(1)).toBe(true);
  });

  it('treats a successful probe as alive', () => {
    vi.spyOn(process, 'kill').mockReturnValue(true);
    expect(isPidGone(1)).toBe(false);
  });
});

describe('killTree', () => {
  afterEach(() => {
    vi.mocked(execFile).mockReset();
    vi.restoreAllMocks();
  });

  it('returns already-gone on Windows exit 128 without reading stderr, and never uses a shell', async () => {
    const restore = withPlatform('win32');
    /** @type {{ file?: string, args?: string[], opts?: Record<string, unknown> }} */
    const seen = {};
    vi.mocked(execFile).mockImplementation((file, args, opts, cb) => {
      seen.file = file;
      seen.args = args;
      seen.opts = opts;
      const err = /** @type {NodeJS.ErrnoException & { stderr?: string }} */ (
        new Error('taskkill failed')
      );
      err.code = 128;
      err.stderr = 'ERROR: The process "4242" not found.';
      setImmediate(() => cb(err));
      return /** @type {import('node:child_process').ChildProcess} */ ({
        kill: () => true,
      });
    });
    try {
      const outcome = await killTree(4242, { graceMs: 1_000 });
      expect(outcome).toBe('already-gone');
      expect(seen.file).toBe(join(process.env.WINDIR || 'C:\\Windows', 'System32', 'taskkill.exe'));
      expect(seen.args).toEqual(['/PID', '4242', '/T', '/F']);
      expect(seen.opts).toMatchObject({
        shell: false,
        windowsHide: true,
      });
      expect(seen.opts?.env).toMatchObject({ MSYS_NO_PATHCONV: '1' });
      expect(seen.opts?.shell).toBe(false);
    } finally {
      restore();
    }
  });

  it('does not inspect localised stderr when deciding already-gone', async () => {
    const restore = withPlatform('win32');
    vi.mocked(execFile).mockImplementation((_file, _args, _opts, cb) => {
      const err = /** @type {NodeJS.ErrnoException & { stderr?: string }} */ (new Error('fallo'));
      err.code = 128;
      err.stderr = 'ERROR: no se encontró el proceso "4242".';
      setImmediate(() => cb(err));
      return /** @type {import('node:child_process').ChildProcess} */ ({
        kill: () => true,
      });
    });
    try {
      expect(await killTree(4242)).toBe('already-gone');
    } finally {
      restore();
    }
  });

  it('returns failed when taskkill exceeds graceMs rather than hanging', async () => {
    const restore = withPlatform('win32');
    vi.mocked(execFile).mockImplementation(() => {
      return /** @type {import('node:child_process').ChildProcess} */ ({
        kill: () => true,
      });
    });
    try {
      expect(await killTree(4242, { graceMs: 30 })).toBe('failed');
    } finally {
      restore();
    }
  });

  it('POSIX path sends SIGKILL even when a ChildProcess would already have killed=true', async () => {
    const restore = withPlatform('linux');
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) return true;
      return true;
    });
    try {
      const child = { pid: 4242, killed: true, exitCode: null, signalCode: null };
      const outcome = await killTree(child.pid, { graceMs: 1 });
      const signals = killSpy.mock.calls.map((c) => c[1]);
      expect(signals).toContain('SIGTERM');
      expect(signals).toContain('SIGKILL');
      expect(outcome === 'killed' || outcome === 'failed').toBe(true);
    } finally {
      restore();
    }
  });

  it('POSIX ESRCH on the group is already-gone', async () => {
    const restore = withPlatform('linux');
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = /** @type {NodeJS.ErrnoException} */ (new Error('ESRCH'));
      err.code = 'ESRCH';
      throw err;
    });
    try {
      expect(await killTree(4242, { graceMs: 1 })).toBe('already-gone');
    } finally {
      restore();
    }
  });
});
