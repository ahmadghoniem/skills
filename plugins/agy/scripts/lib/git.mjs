// Two `git status --porcelain` snapshots bracket every run. Their delta is the
// file count on the `agy status` line and the `filesChanged` field on every
// friction-log row, which is read after the diff itself is gone.
import { run } from './run.mjs';

/**
 * @param {string} [cwd]
 * @returns {Promise<string>}
 */
export async function repoRoot(cwd = process.cwd()) {
  const res = await run('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    timeoutMs: 3_000,
  });
  if (res.exitCode === 0) return res.stdout.trim() || cwd;
  return cwd;
}

/**
 * @typedef {Object} GitFile
 * @property {string} status   Single letter: M, A, D, R
 * @property {string} path
 */

/**
 * Parse `git status --porcelain` into a list of touched files.
 * Untracked files (`??`) are mapped to `A`.
 *
 * @param {string} text
 * @returns {GitFile[]}
 */
export function parsePorcelain(text) {
  /** @type {GitFile[]} */
  const files = [];
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    if (rawLine.length < 4) continue;
    const xy = rawLine.slice(0, 2);
    let path = rawLine.slice(3);
    if (path.startsWith('"') && path.endsWith('"')) {
      path = path.slice(1, -1).replace(/\\"/g, '"');
    }
    if (path.includes(' -> ')) {
      const parts = path.split(' -> ');
      path = parts[parts.length - 1] ?? path;
    }
    if (!path) continue;
    files.push({ status: porcelainLetter(xy), path });
  }
  return files;
}

/**
 * @param {string} xy
 * @returns {string}
 */
function porcelainLetter(xy) {
  if (xy.includes('U')) return 'M';
  if (xy.includes('D')) return 'D';
  if (xy.includes('R') || xy.includes('C')) return 'R';
  if (xy === '??' || xy.includes('A') || xy.includes('?')) return 'A';
  return 'M';
}

/**
 * @param {string} [cwd]
 * @returns {Promise<GitFile[]|null>}  null when git is unavailable / not a repo
 */
export async function porcelain(cwd = process.cwd()) {
  const res = await run('git', ['status', '--porcelain'], {
    cwd,
    timeoutMs: 5_000,
  });
  if (res.exitCode !== 0) return null;
  return parsePorcelain(res.stdout);
}

/**
 * Files whose porcelain line changed between two snapshots.
 *
 * @param {GitFile[]} before
 * @param {GitFile[]} after
 * @returns {GitFile[]}
 */
export function porcelainDelta(before, after) {
  const prior = new Set((before ?? []).map((f) => `${f.status}\0${f.path}`));
  return (after ?? []).filter((f) => !prior.has(`${f.status}\0${f.path}`));
}
