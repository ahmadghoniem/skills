// The workspace as a round starts and as it ends, so the summary can flag an
// edit made while the seats were reading. In a git repo: the commit, plus each
// uncommitted file's status, size and modified time, so a second edit to a file
// that was already uncommitted shows too. Outside git: every file's size and
// modified time.

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { run } from '../../scripts/lib/shared/proc.mjs';

const SKIP = new Set(['.git', 'node_modules']);
/** Past this many files a folder outside git isn't watched. */
export const MAX_FILES = 20_000;

function stamp(path) {
  try {
    const s = statSync(path);
    return `${s.size}:${Math.round(s.mtimeMs)}`;
  } catch {
    return 'gone';
  }
}

/** Every file under root but .git and node_modules, or null past MAX_FILES. */
function walk(root) {
  const files = new Map();
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) stack.push(p);
      } else if (e.isFile()) {
        if (files.size >= MAX_FILES) return null;
        files.set(relative(root, p).replaceAll('\\', '/'), stamp(p));
      }
    }
  }
  return files;
}

/**
 * @returns {Promise<{sha: string|null, files: Map<string, string>|null}>}
 *   `sha` is null outside git; `files` is null when a folder outside git is too big to watch.
 */
export async function snapshot(cwd) {
  const head = await run('git', ['rev-parse', '--show-toplevel', '--short', 'HEAD'], { cwd, timeoutMs: 10_000 });
  if (head.exitCode !== 0) return { sha: null, files: walk(cwd) };
  const [top, sha] = head.stdout.trim().split(/\r?\n/);
  const status = await run('git', ['status', '--porcelain', '--untracked-files=all', '-z'], { cwd, timeoutMs: 20_000 });
  const files = new Map();
  const parts = status.stdout.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    files.set(path, `${xy}|${stamp(join(top, path))}`);
    if (/[RC]/.test(xy)) i++; // the next part is the rename's old path
  }
  return { sha, files };
}

/** What changed between two snapshots: a moved HEAD first, then the paths. */
export function changedDuring(before, after) {
  const out = [];
  if (before.sha !== after.sha) out.push(`HEAD moved ${before.sha} → ${after.sha}`);
  if (!before.files || !after.files) return out;
  const paths = new Set();
  for (const [p, v] of after.files) if (before.files.get(p) !== v) paths.add(p);
  for (const p of before.files.keys()) if (!after.files.has(p)) paths.add(p);
  return out.concat([...paths].sort());
}
