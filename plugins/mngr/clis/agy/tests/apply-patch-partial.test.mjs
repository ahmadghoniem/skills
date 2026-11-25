import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { failedPatch } from '../mcp/apply-patch-partial.mjs';
import { parsePatch } from '../mcp/apply-patch.mjs';

const SCRIPT = fileURLToPath(new URL('../mcp/apply-patch-partial.mjs', import.meta.url));
const TOOLS = fileURLToPath(new URL('../../../../../tools/apply-patch/apply-patch.mjs', import.meta.url));
const block = (s, r) => `<<<<<<< SEARCH\n${s}\n=======\n${r}\n>>>>>>> REPLACE\n`;
const dir = (files) => {
  const d = mkdtempSync(join(tmpdir(), 'ap-partial-'));
  for (const [n, b] of Object.entries(files)) writeFileSync(join(d, n), b);
  return d;
};
const run = (d, patch, args = []) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: d, input: patch, encoding: 'utf8' });

describe('apply-patch-partial', () => {
  it('writes the blocks that match, lists the ones that fail, exits 1', () => {
    const d = dir({ 'a.ts': 'one\ntwo\nthree\nfour\n' });
    const r = run(d, `*** Update: a.ts\n${block('one', 'ONE')}${block('nope', 'x')}${block('three', 'THREE')}${block('gone', 'y')}`);
    expect(r.status).toBe(1);
    expect(readFileSync(join(d, 'a.ts'), 'utf8')).toBe('ONE\ntwo\nTHREE\nfour\n');
    expect(r.stdout).toMatch(/updated  a\.ts #1: line 1, exact/);
    expect(r.stdout).toMatch(/updated  a\.ts #3: line 3, exact/);
    expect(r.stdout).toMatch(/^partial: 1 file\(s\) written, 2 problem\(s\) not applied$/m);
    expect(r.stderr).toMatch(/1\. a\.ts block at patch line 7: SEARCH text not found/);
    expect(r.stderr).toMatch(/2\. a\.ts block at patch line 17: SEARCH text not found/);
    expect(r.stderr).toMatch(/Send only these again/);
  });

  it('a check chained with && does not run when a block failed', () => {
    const d = dir({ 'a.ts': 'one\n' });
    const patch = `*** Update: a.ts\n${block('one', 'ONE')}${block('nope', 'x')}`;
    const r = spawnSync('bash', ['-c', `node '${SCRIPT.replace(/\\/g, '/')}' <<'PATCH' && echo CHECK-RAN\n${patch}PATCH`], { cwd: d, encoding: 'utf8' });
    expect(r.stdout).not.toMatch(/CHECK-RAN/);
    expect(readFileSync(join(d, 'a.ts'), 'utf8')).toBe('ONE\n');
  });

  it('a whole patch behaves exactly like apply-patch', () => {
    const d = dir({ 'a.ts': 'one\n' });
    const r = run(d, `*** Update: a.ts\n${block('one', 'ONE')}`);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('updated  a.ts #1: line 1, exact\nok: 1 file(s)\n');
  });

  it('writes nothing when every block fails, or the patch does not parse', () => {
    const d = dir({ 'a.ts': 'one\n' });
    let r = run(d, `*** Update: a.ts\n${block('nope', 'x')}`);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/No files were changed/);
    r = run(d, '*** Update: a.ts\n<<<<<<< SEARCH\none\n');
    expect(r.status).toBe(1);
    expect(readFileSync(join(d, 'a.ts'), 'utf8')).toBe('one\n');
  });

  it('a kept --file patch is rewritten to hold only the failed blocks', () => {
    const d = dir({ 'a.ts': 'one\ntwo\n', 'b.ts': 'x\n' });
    const pf = join(d, 'p.patch');
    writeFileSync(pf, `*** Update: a.ts\n${block('one', 'ONE')}${block('nope', 'N')}*** Update: b.ts\n${block('x', 'X')}*** Create: a.ts\nagain\n`);
    const r = run(d, '', ['--file', pf]);
    expect(r.status).toBe(1);
    expect(readFileSync(join(d, 'a.ts'), 'utf8')).toBe('ONE\ntwo\n');
    expect(readFileSync(join(d, 'b.ts'), 'utf8')).toBe('X\n');
    const left = parsePatch(readFileSync(pf, 'utf8'));
    expect(left.map((o) => [o.kind, o.path, o.blocks?.map((b) => b.search)])).toEqual([
      ['update', 'a.ts', ['nope']],
      ['create', 'a.ts', undefined],
    ]);
  });

  it('failedPatch writes text apply-patch parses back to the same blocks', () => {
    const ops = parsePatch(`*** Update: a\n<<<<<<< SEARCH all\nx\n=======\ny\n>>>>>>> REPLACE\n*** Delete: b\n`);
    const again = parsePatch(failedPatch([{ op: ops[0], block: ops[0].blocks[0] }, { op: ops[1] }]));
    expect(again).toMatchObject([{ kind: 'update', path: 'a', blocks: [{ all: true, search: 'x', replace: 'y' }] }, { kind: 'delete', path: 'b' }]);
  });

  it('mcp/apply-patch.mjs is a symlink to tools/apply-patch, not a copy that can drift', () => {
    const agy = fileURLToPath(new URL('../mcp/apply-patch.mjs', import.meta.url));
    // A checkout with core.symlinks=false turns the link into a text file holding its target.
    expect(lstatSync(agy).isSymbolicLink()).toBe(true);
    expect(realpathSync(agy)).toBe(realpathSync(TOOLS));
  });
});
