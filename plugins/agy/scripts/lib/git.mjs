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
 * The history an agent could search, noted only when it is short: a shallow
 * clone or a single commit. Undefined for a full history or no repository.
 *
 * @param {string} cwd
 * @returns {Promise<string|undefined>}
 */
export async function shortHistory(cwd) {
  const count = await run('git', ['rev-list', '--count', 'HEAD'], { cwd, timeoutMs: 3_000 });
  if (count.exitCode !== 0) return undefined;
  const n = Number(count.stdout.trim());
  const shallow = await run('git', ['rev-parse', '--is-shallow-repository'], { cwd, timeoutMs: 3_000 });
  const isShallow = shallow.stdout.trim() === 'true';
  if (!isShallow && n > 1) return undefined;
  if (n === 1) return `1 commit${isShallow ? ', shallow clone' : ''}, so no history to search: commits the task names are not in it`;
  return `${n} commits, shallow clone: older commits, including any the task names, may be missing`;
}
