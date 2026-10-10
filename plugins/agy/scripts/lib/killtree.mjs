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
 * Kill a process and its descendants: `taskkill.exe /T /F` on Windows, SIGKILL
 * to every process in the tree elsewhere.
 *
 * On Windows it runs `taskkill.exe /T /F`
 * via `execFile` (`shell: false` avoids MSYS `/PID` path rewriting).
 * Root is not signalled first to prevent descendant leakage during enumeration.
 * Exit code 128 indicates process not found; stderr is localised.
 *
 * @param {number} pid
 * @param {{ taskkillTimeoutMs?: number }} [opts]
 * @returns {Promise<'killed'|'already-gone'|'failed'>}
 */
export async function killTree(pid, { taskkillTimeoutMs = 5000 } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return 'failed';
  const budget = Number.isFinite(taskkillTimeoutMs) && taskkillTimeoutMs > 0 ? taskkillTimeoutMs : 5000;
  return process.platform === 'win32' ? killWindows(pid, budget) : killPosix(pid, budget);
}

/**
 * List every process's parent with `ps`, then SIGKILL `pid` and all its
 * descendants. The list is taken before any signal, so a child re-parented to
 * init when its parent dies is still killed.
 *
 * @param {number} pid
 * @param {number} timeoutMs
 * @returns {Promise<'killed'|'already-gone'|'failed'>}
 */
function killPosix(pid, timeoutMs) {
  if (isPidGone(pid)) return Promise.resolve('already-gone');
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid='], { timeout: timeoutMs }, (err, stdout) => {
      /** @type {Map<number, number[]>} */
      const kids = new Map();
      if (!err) {
        for (const line of stdout.split('\n')) {
          const [p, pp] = line.trim().split(/\s+/).map(Number);
          if (p > 0 && pp > 0) kids.set(pp, [...(kids.get(pp) ?? []), p]);
        }
      }
      const tree = [pid];
      for (let i = 0; i < tree.length; i++) tree.push(...(kids.get(tree[i]) ?? []).filter((c) => !tree.includes(c)));
      let killed = false;
      for (const p of tree) {
        try {
          process.kill(p, 'SIGKILL');
          killed = true;
        } catch {
          // gone already
        }
      }
      resolve(killed ? 'killed' : isPidGone(pid) ? 'already-gone' : 'failed');
    });
  });
}

/**
 * @param {number} pid
 * @param {number} taskkillTimeoutMs
 * @returns {Promise<'killed'|'already-gone'|'failed'>}
 */
function killWindows(pid, taskkillTimeoutMs) {
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
      }, taskkillTimeoutMs);
    }
  });
}
