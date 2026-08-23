// Windows spawn shims.
//
// Unlike cursor-agent — which installs only `.cmd`/`.ps1` wrappers around a
// bundled node runtime — the Grok CLI installs a real `grok.exe`, so there is
// no shim to unwrap here. What remains are the two cases Node still gets wrong
// on Windows:
//
//   1. A `.mjs`/`.cjs`/`.js` path is not directly executable (a shebang means
//      nothing to Windows), and spawning one raises EFTYPE. Run it under the
//      current Node instead.
//   2. Node refuses to spawn a `.cmd`/`.bat` without `shell: true` (the fix for
//      CVE-2024-27980). We never want `shell: true` — it would route a prompt
//      through cmd.exe where `%VAR%` still expands — so such a path is passed
//      through untouched and the caller sees the spawn error rather than a
//      silently mangled command line.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SCRIPT_EXT = /\.(mjs|cjs|js)$/i;

/**
 * Where the Grok installer puts the CLI, if it is there.
 *
 * The installer appends its directory to the *persistent* user PATH, which a
 * Claude Code session started beforehand will not have picked up — so a
 * `where grok` miss does not mean grok is absent. Checking this path directly
 * is what makes the plugin work in an already-running session.
 *
 * @returns {string|null}
 */
export function defaultGrokBin() {
  const exe = process.platform === 'win32' ? 'grok.exe' : 'grok';
  const candidate = join(homedir(), '.grok', 'bin', exe);
  return existsSync(candidate) ? candidate : null;
}

/**
 * Rewrite a spawn of a Node script into a spawn of the current Node runtime.
 * Anything else (a real `.exe`, `git`, `where`, any non-Windows path) passes
 * through unchanged.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {[string, string[]]}
 */
export function adaptWindowsBin(cmd, args) {
  if (process.platform !== 'win32') return [cmd, args];
  if (SCRIPT_EXT.test(cmd)) return [process.execPath, [cmd, ...args]];
  return [cmd, args];
}
