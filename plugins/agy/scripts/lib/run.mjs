// Thin Promise wrapper around child_process.spawn with:
//   - no throw on non-zero exit (resolve with exitCode)
//   - optional timeout (tree-kill the child, 5 s grace)
//   - stdout/stderr captured as strings
//
// Replaces the subset of `execa` that this plugin actually uses.

import { spawn } from 'node:child_process';
import { killTree } from './killtree.mjs';

/**
 * @typedef {Object} RunOpts
 * @property {string=} cwd
 * @property {number=} timeoutMs          Kill the child after this many ms.
 * @property {NodeJS.ProcessEnv=} env
 */

/**
 * @typedef {Object} RunResult
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} exitCode            -1 if we killed on timeout.
 * @property {boolean} timedOut
 */

/**
 * Spawn a process. If `cmd` is a Node script (test stub), run it with
 * `process.execPath` so Windows can execute a `.mjs` without a shim.
 * Production `agy.exe` is a native Go binary and is spawned directly.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} options
 */
export function spawnDirect(cmd, args, options) {
  const opts = { shell: false, ...options };
  if (typeof cmd === 'string' && /\.(mjs|cjs|js)$/i.test(cmd)) {
    return spawn(process.execPath, [cmd, ...args], opts);
  }
  return spawn(cmd, args, opts);
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {RunOpts} [opts]
 * @returns {Promise<RunResult>}
 */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawnDirect(cmd, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.env ?? process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => {
        stdout += d;
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (d) => {
        stderr += d;
      });
    }
    let timeout;
    if (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        if (typeof child.pid === 'number') {
          void killTree(child.pid, { graceMs: 5_000 });
        }
      }, opts.timeoutMs);
    }
    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        stdout,
        stderr: stderr || String(err?.message ?? err ?? 'spawn error'),
        exitCode: -1,
        timedOut,
      });
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        exitCode: typeof code === 'number' ? code : timedOut ? -1 : 1,
        timedOut,
      });
    });
  });
}
