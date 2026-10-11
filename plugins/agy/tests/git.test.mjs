import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { shortHistory } from '../scripts/lib/git.mjs';

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cad-git-'));
  dirs.push(dir);
  return dir;
}

function repoWithCommits(n) {
  const dir = tempDir();
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  for (let i = 0; i < n; i++) {
    writeFileSync(join(dir, 'f.txt'), String(i));
    git('add', '-A');
    git('commit', '-qm', `c${i}`);
  }
  return dir;
}

describe('shortHistory', () => {
  it('notes a single commit', async () => {
    expect(await shortHistory(repoWithCommits(1))).toBe('1 commit, so no history to search: commits the task names are not in it');
  });

  it('notes a shallow clone', async () => {
    const src = repoWithCommits(3).split('\\').join('/');
    const dst = join(tempDir(), 'clone');
    spawnSync('git', ['clone', '-q', '--depth', '1', `file:///${src.replace(/^\//, '')}`, dst]);
    expect(await shortHistory(dst)).toBe('1 commit, shallow clone, so no history to search: commits the task names are not in it');
  });

  it('says nothing for a full history or no repository', async () => {
    expect(await shortHistory(repoWithCommits(2))).toBeUndefined();
    expect(await shortHistory(tempDir())).toBeUndefined();
  });
});
