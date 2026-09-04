import { execFile } from 'node:child_process';
import { join } from 'node:path';

/**
 * True when `pid` refers to no process (`process.kill(pid, 0)` throws `ESRCH`).
 * `EPERM` indicates a live process that cannot be signalled by this user.
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
 * Kill a process and its descendants on Windows using `taskkill.exe /T /F`
 * via `execFile` (`shell: false` avoids MSYS `/PID` path rewriting).
 * Root is not signalled first to prevent descendant leakage during enumeration.
 * Exit code 128 indicates process not found; stderr is localised.
 *
 * @param {number} pid
 * @param {{ graceMs?: number }} [opts]
 * @returns {Promise<'killed'|'already-gone'|'failed'>}
 */
export async function killTree(pid, { graceMs = 5000 } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return 'failed';
  const budget = Number.isFinite(graceMs) && graceMs > 0 ? graceMs : 5000;
  return killWindows(pid, budget);
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
    // Un-shelled spawn prevents MSYS from rewriting `/PID`.
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
