import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePatch, planPatch, commit, PatchError } from './apply-patch.mjs';

const SCRIPT = fileURLToPath(new URL('./apply-patch.mjs', import.meta.url));

function dir(files = {}) {
  const d = mkdtempSync(join(tmpdir(), 'apply-patch-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
  return d;
}
const apply = (d, patch) => { const plan = planPatch(parsePatch(patch), d); commit(plan); return plan.report; };
const read = (d, name) => readFileSync(join(d, name), 'utf8');
const block = (search, replace, all = '') => `<<<<<<< SEARCH${all}\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n`;

test('several blocks in several files', () => {
  const d = dir({ 'a.js': 'const a = 1;\nconst b = 2;\n', 'b.js': 'x\ny\n' });
  apply(d, `*** Update: a.js\n${block('const a = 1;', 'const a = 10;')}${block('const b = 2;', 'const b = 20;')}*** Update: b.js\n${block('y', 'z')}`);
  assert.equal(read(d, 'a.js'), 'const a = 10;\nconst b = 20;\n');
  assert.equal(read(d, 'b.js'), 'x\nz\n');
});

test('one failing block writes nothing', () => {
  const d = dir({ 'a.js': 'one\n', 'b.js': 'two\n' });
  assert.throws(() => apply(d, `*** Update: a.js\n${block('one', 'ONE')}*** Update: b.js\n${block('missing', 'x')}`), /not found/);
  assert.equal(read(d, 'a.js'), 'one\n');
  assert.equal(read(d, 'b.js'), 'two\n');
});

test('ambiguous match is refused, "all" replaces every copy', () => {
  const d = dir({ 'a.txt': 'foo\nfoo\n' });
  assert.throws(() => apply(d, `*** Update: a.txt\n${block('foo', 'bar')}`), /matches 2 times \(lines 1, 2\)/);
  const r = apply(d, `*** Update: a.txt\n${block('foo', 'bar', ' all')}`);
  assert.equal(read(d, 'a.txt'), 'bar\nbar\n');
  assert.match(r[0], /2 replacements/);
});

test('empty SEARCH is refused', () => {
  const d = dir({ 'a.txt': 'abc\n' });
  assert.throws(() => apply(d, `*** Update: a.txt\n<<<<<<< SEARCH\n=======\nx\n>>>>>>> REPLACE\n`), /SEARCH is empty/);
  assert.equal(read(d, 'a.txt'), 'abc\n');
});

test('CRLF file stays CRLF; LF file stays LF', () => {
  const d = dir({ 'w.txt': 'a\r\nb\r\nc\r\n', 'u.txt': 'a\nb\nc\n' });
  apply(d, `*** Update: w.txt\n${block('a\nb', 'a\nB\nb2')}*** Update: u.txt\n${block('b\nc', 'B\nc')}`);
  assert.equal(read(d, 'w.txt'), 'a\r\nB\r\nb2\r\nc\r\n');
  assert.equal(read(d, 'u.txt'), 'a\nB\nc\n');
});

test('BOM is kept', () => {
  const d = dir({ 'b.txt': '\uFEFFhello\n' });
  apply(d, `*** Update: b.txt\n${block('hello', 'bye')}`);
  assert.equal(read(d, 'b.txt'), '\uFEFFbye\n');
});

test('falls back to ignoring trailing whitespace, then indentation, and says so', () => {
  const d = dir({ 'a.py': 'def f():   \n    return 1\n', 'b.py': 'if x:\n        y = 1\n' });
  const r = apply(d, `*** Update: a.py\n${block('def f():\n    return 1', 'def f():\n    return 2')}*** Update: b.py\n${block('    y = 1', '        y = 2')}`);
  assert.equal(read(d, 'a.py'), 'def f():\n    return 2\n');
  assert.equal(read(d, 'b.py'), 'if x:\n        y = 2\n');
  assert.match(r[0], /ignoring trailing-whitespace/);
  assert.match(r[1], /ignoring indentation/);
});

test('ambiguous fallback match lists its lines', () => {
  const d = dir({ 'a.py': 'x = 0\n  y = 1\nz = 2\n    y = 1\n' });
  assert.throws(() => apply(d, `*** Update: a.py\n${block('y = 1', 'y = 3')}`), /matches 2 times \(lines 2, 4\)/);
  const e = dir({ 'a.py': '\ty = 1\nz = 2\n\ty = 1\n' });
  assert.throws(() => apply(e, `*** Update: a.py\n${block('  y = 1', 'y = 3')}`), /matches 2 times ignoring indentation \(lines 1, 3\)/);
});

test('empty REPLACE removes whole lines', () => {
  const d = dir({ 'a.txt': 'keep\ndrop1\ndrop2\nkeep2\n' });
  apply(d, `*** Update: a.txt\n${block('drop1\ndrop2', '')}`);
  assert.equal(read(d, 'a.txt'), 'keep\nkeep2\n');
});

test('later blocks see earlier edits to the same file', () => {
  const d = dir({ 'a.txt': 'alpha\n' });
  apply(d, `*** Update: a.txt\n${block('alpha', 'beta')}${block('beta', 'gamma')}`);
  assert.equal(read(d, 'a.txt'), 'gamma\n');
});

test('create, append, delete', () => {
  const d = dir({ 'old.txt': 'x\n', 'log.txt': 'line1' });
  apply(d, '*** Create: sub/new.txt\nhello\nworld\n\n*** Append: log.txt\nline2\n*** Delete: old.txt\n');
  assert.equal(read(d, 'sub/new.txt'), 'hello\nworld\n');
  assert.equal(read(d, 'log.txt'), 'line1\nline2\n');
  assert.equal(existsSync(join(d, 'old.txt')), false);
});

test('create refuses an existing file; update refuses a missing one', () => {
  const d = dir({ 'a.txt': 'a\n' });
  assert.throws(() => apply(d, '*** Create: a.txt\nx\n'), /already exists/);
  assert.throws(() => apply(d, `*** Update: nope.txt\n${block('a', 'b')}`), /file not found/);
});

test('malformed patches are rejected with a line number', () => {
  assert.throws(() => parsePatch('hello\n'), PatchError);
  assert.throws(() => parsePatch('*** Update: a\n<<<<<<< SEARCH\nx\n>>>>>>> REPLACE\n'), /divider/);
  assert.throws(() => parsePatch('*** Update: a\n<<<<<<< SEARCH\nx\n=======\ny\n'), /end marker/);
  assert.throws(() => parsePatch(''), /empty/);
});

test('CLI: stdin, --file, --dry-run, exit codes, no temp files left', () => {
  const d = dir({ 'a.txt': 'one\n' });
  const patch = `*** Update: a.txt\n${block('one', 'two')}`;
  let r = spawnSync(process.execPath, [SCRIPT, '--dry-run'], { cwd: d, input: patch, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /dry run/);
  assert.equal(read(d, 'a.txt'), 'one\n');
  writeFileSync(join(d, 'p.patch'), patch);
  r = spawnSync(process.execPath, [SCRIPT, '--file', 'p.patch'], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(d, 'a.txt'), 'two\n');
  r = spawnSync(process.execPath, [SCRIPT], { cwd: d, input: patch, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No files were changed/);
  assert.deepEqual(readdirSync(d).filter((f) => f.endsWith('.tmp')), []);
});
