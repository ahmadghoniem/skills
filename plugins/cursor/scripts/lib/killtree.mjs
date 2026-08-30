import { execFile } from 'node:child_process';
import { join } from 'node:path';

/**
 * True when `pid` refers to no process (`process.kill(pid, 0)` throws `ESRCH`).
 * Other errors — notably `EPERM` — mean the pid still names a live process this
 * account cannot signal. Treating any throw as "dead" is a Windows footgun:
 * probing a pid you do not own commonly raises `EPERM`, and reading that as
 * "already dead" marks a live billed job cancelled without killing it.
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function isPidGone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return Boolean(err && typeof err === 'object' && err.code === 'ESRCH');
  }
}

/**
 * Kill a process and its descendants.
 *
 * Windows: `taskkill.exe /T /F` via `execFile` with `shell: false`. Spawning
 * `taskkill` through a shell on Git-Bash-for-Windows makes MSYS rewrite `/PID`
 * into `C:/Program Files/Git/PID` and the kill silently does nothing. Do not
 * SIGTERM the root first: if it exits before `taskkill /T` runs, Windows can
 * no longer enumerate descendants and grandchildren leak. Exit code 128 is
 * "process not found" (`already-gone`); do not parse stderr (it is localised).
 *
 * POSIX: signal the process group (`-pid`). The CLI child must have been
 * spawned `detached: true` without `unref()` so it is a group leader.
 *
 * @param {number} pid
 * @param {{ graceMs?: number }} [opts]
 * @returns {Promise<'killed'|'already-gone'|'failed'>}
 */
export async function killTree(pid, { graceMs = 5000 } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return 'failed';
  const budget = Number.isFinite(graceMs) && graceMs > 0 ? graceMs : 5000;
  if (process.platform === 'win32') return killWindows(pid, budget);
  return killPosix(pid, budget);
}

/**
 * @param {number} pid
 * @param {number} graceMs
 * @returns {Promise<'killed'|'already-gone'|'failed'>}
 */
function killWindows(pid, graceMs) {
  const taskkillPath = join(process.env.WINDIR || 'C:\\Windows', 'System32', 'taskkill.exe');
  const args = ['/PID', String(pid), '/T', '/F'];
  const options = {
    // Mandatory: a shelled spawn lets Git-Bash MSYS rewrite `/PID`.
    shell: false,
    windowsHide: true,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  };

  return new Promise((resolve) => {
    let settled = false;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timer;
    /** @param {'killed'|'already-gone'|'failed'} value */
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };

    const child = execFile(taskkillPath, args, options, (err) => {
      if (!err) {
        finish('killed');
        return;
      }
      // Exit 128 = process not found. Do not inspect stderr: it is localised.
      const code = typeof err === 'object' && err && 'code' in err ? err.code : undefined;
      if (code === 128) {
        finish('already-gone');
        return;
      }
      finish('failed');
    });

    if (!settled) {
      timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // noop
        }
        finish('failed');
      }, graceMs);
    }
  });
}

/**
 * @param {number} pid
 * @param {number} graceMs
 * @returns {Promise<'killed'|'already-gone'|'failed'>}
 */
async function killPosix(pid, graceMs) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ESRCH') return 'already-gone';
    return 'failed';
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && !isPidGone(pid)) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (isPidGone(pid)) return 'killed';
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ESRCH') return 'killed';
    return 'failed';
  }
  const killDeadline = Date.now() + Math.min(200, graceMs);
  while (Date.now() < killDeadline && !isPidGone(pid)) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return isPidGone(pid) ? 'killed' : 'failed';
}
