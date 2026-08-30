// Windows compatibility shim for spawning the Cursor CLI.
//
// Node refuses to spawn a `.cmd`/`.bat` without `shell: true` (the fix for
// CVE-2024-27980) and throws EINVAL instead. On Windows the Cursor CLI installs
// only shims — `cursor-agent.cmd` -> `cursor-agent.ps1` -> `node.exe index.js` —
// so every spawn of the resolved binary fails. Using `shell: true` would work but
// routes an arbitrary prompt through cmd.exe, where `%VAR%` still expands.
//
// Instead we skip the shims and spawn the `node.exe` + `index.js` they wrap, which
// is a plain `.exe` and needs no shell.

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SHIM_EXT = /\.(cmd|bat|ps1)$/i;
const SCRIPT_EXT = /\.(mjs|cjs|js)$/i;

/** Highest-sorting `versions/<v>` dir that actually contains the runtime. */
function latestVersionDir(root) {
  const versions = join(root, 'versions');
  if (!existsSync(versions)) return null;
  const candidates = readdirSync(versions)
    .filter((name) => /^\d{4}\.\d{1,2}\.\d{1,2}/.test(name))
    .map((name) => {
      const [y, m, d] = name.split('-')[0].split('.');
      return { name, key: Number(y) * 10000 + Number(m) * 100 + Number(d) };
    })
    .sort((a, b) => b.key - a.key);
  for (const { name } of candidates) {
    const dir = join(versions, name);
    if (existsSync(join(dir, 'node.exe')) && existsSync(join(dir, 'index.js'))) return dir;
  }
  return null;
}

/**
 * Where the Windows installer puts the CLI, if it is there.
 *
 * @returns {string|null}
 */
export function defaultWindowsBin() {
  if (process.platform !== 'win32') return null;
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  const shim = join(local, 'cursor-agent', 'cursor-agent.cmd');
  return existsSync(shim) ? shim : null;
}

/**
 * Rewrite a spawn of a Windows shim into a spawn of the runtime behind it.
 * Anything else (a real `.exe`, `which`, any non-Windows path) passes through.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {[string, string[]]}
 */
export function adaptWindowsBin(cmd, args) {
  if (process.platform !== 'win32') return [cmd, args];
  // A shebang makes a `.mjs` directly executable on POSIX but not on Windows, where
  // spawning one raises EFTYPE. Run it under the current Node instead.
  if (SCRIPT_EXT.test(cmd)) return [process.execPath, [cmd, ...args]];
  if (!SHIM_EXT.test(cmd)) return [cmd, args];
  const root = dirname(cmd);
  const dir =
    existsSync(join(root, 'node.exe')) && existsSync(join(root, 'index.js'))
      ? root
      : latestVersionDir(root);
  if (!dir) return [cmd, args];
  return [join(dir, 'node.exe'), [join(dir, 'index.js'), ...args]];
}
