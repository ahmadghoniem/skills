import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isGitRepo, repoRoot } from '../scripts/lib/git.mjs';
import { run } from '../scripts/lib/run.mjs';

describe('git', () => {
  let repo;
  let nonRepo;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'ccd-git-repo-'));
    nonRepo = mkdtempSync(join(tmpdir(), 'ccd-git-none-'));
    await run('git', ['init', '-q'], { cwd: repo, timeoutMs: 5_000 });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(nonRepo, { recursive: true, force: true });
  });

  it('isGitRepo is true inside a repo and false outside one', async () => {
    expect(await isGitRepo(repo)).toBe(true);
    expect(await isGitRepo(nonRepo)).toBe(false);
  });

  it('repoRoot returns the repository top-level for a repo cwd', async () => {
    const root = await repoRoot(repo);
    // macOS/Windows temp dirs can be symlinked/8.3-shortened, so compare on the
    // final path segment rather than the full absolute path.
    expect(root.split(/[\\/]/).pop()).toBe(repo.split(sep).pop());
  });

  it('repoRoot falls back to the given cwd outside a repo', async () => {
    expect(await repoRoot(nonRepo)).toBe(nonRepo);
  });
});
