import { run } from './run.mjs';

/**
 * @param {string} [cwd]
 * @returns {Promise<boolean>}
 */
export async function isRepo(cwd = process.cwd()) {
  const res = await run('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd,
    timeoutMs: 3_000,
  });
  return res.exitCode === 0 && res.stdout.trim() === 'true';
}

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
 *
 * Untracked (`??`) is reported as `A` so the result block reads like a
 * short-status add rather than a git-internal code.
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
 * @param {string} [cwd]
 * @returns {Promise<boolean>}
 */
export async function isDirty(cwd = process.cwd()) {
  const files = await porcelain(cwd);
  return Array.isArray(files) && files.length > 0;
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

/**
 * Serialise a porcelain snapshot onto a job record.
 *
 * @param {GitFile[]} files
 * @returns {Array<{status: string, path: string}>}
 */
export function snapshotFiles(files) {
  return (files ?? []).map((f) => ({ status: f.status, path: f.path }));
}
