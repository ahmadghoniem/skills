import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { check, relink } from './relink.mjs';

const json = (path, value) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
};

/** A repo with one plugin at `version`, installed by Claude Code as a real copy under 0.1.0, plus a stale link. */
function fixture(version) {
  const root = mkdtempSync(join(tmpdir(), 'relink-'));
  const repo = join(root, 'repo');
  const claudeHome = join(root, 'claude');
  json(join(repo, '.claude-plugin', 'marketplace.json'), { name: 'mkt', plugins: [{ name: 'demo', source: './plugins/demo' }] });
  json(join(repo, 'plugins', 'demo', 'plugin.json'), { name: 'demo', version });
  const cache = join(claudeHome, 'plugins', 'cache', 'mkt', 'demo');
  mkdirSync(join(cache, '0.1.0'), { recursive: true });
  writeFileSync(join(cache, '0.1.0', 'copied.txt'), 'a frozen copy');
  json(join(claudeHome, 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: { 'demo@mkt': [{ scope: 'user', installPath: join(cache, '0.1.0'), version: '0.1.0' }] },
  });
  return { root, repo, claudeHome, cache };
}

test('a copy instead of a junction is reported, and relink fixes it after a version bump', (t) => {
  const f = fixture('0.1.1');
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  assert.ok(check(f).length > 0);

  relink({ ...f, log: () => {} });

  assert.deepEqual(check(f), []);
  assert.ok(lstatSync(join(f.cache, '0.1.1')).isSymbolicLink());
  assert.ok(existsSync(join(f.cache, '0.1.1', 'plugin.json')));
  const entry = JSON.parse(readFileSync(join(f.claudeHome, 'plugins', 'installed_plugins.json'), 'utf8')).plugins['demo@mkt'][0];
  assert.equal(entry.version, '0.1.1');
  // The old real copy is left in place, not deleted.
  assert.ok(existsSync(join(f.cache, '0.1.0', 'copied.txt')));
});

test('relink replaces Claude Code\'s copy under the current version and removes old links', (t) => {
  const f = fixture('0.1.0');
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  relink({ ...f, log: () => {} });
  assert.deepEqual(check(f), []);
  assert.ok(lstatSync(join(f.cache, '0.1.0')).isSymbolicLink());
  // The repo behind the junction is untouched.
  assert.ok(existsSync(join(f.repo, 'plugins', 'demo', 'plugin.json')));
});

test('this machine: every installed plugin from this repo is a junction under its current version', () => {
  const problems = check();
  assert.deepEqual(problems, [], `${problems.join('\n')}\nRun \`npm run relink\` from the repo root.`);
});
