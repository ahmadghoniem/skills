import { run } from './shared/proc.mjs';

/** The commit a round is frozen at, and the uncommitted files, or null outside git. */
export async function snapshot(cwd) {
  const head = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd, timeoutMs: 10_000 });
  if (head.exitCode !== 0) return null;
  const status = await run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, timeoutMs: 20_000 });
  return { sha: head.stdout.trim(), dirty: status.stdout.split(/\r?\n/).filter(Boolean).sort() };
}

/** Lines in `after` that were not in `before`, or are gone from it. */
export function changedDuring(before, after) {
  if (!before || !after) return [];
  const b = new Set(before.dirty);
  const a = new Set(after.dirty);
  const out = [...a].filter((l) => !b.has(l)).concat([...b].filter((l) => !a.has(l)));
  if (before.sha !== after.sha) out.unshift(`HEAD moved ${before.sha} → ${after.sha}`);
  return out;
}
