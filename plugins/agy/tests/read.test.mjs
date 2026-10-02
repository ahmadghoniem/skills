import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseReadSpec, readFiles } from '../scripts/lib/read.mjs';

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cad-read-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), 'one\r\ntwo\r\nthree\r\n', 'utf8');
  writeFileSync(join(root, 'b.txt'), 'alpha\nbeta', 'utf8');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('parseReadSpec', () => {
  it('splits a line range off the path, keeping a drive letter', () => {
    expect(parseReadSpec('a.ts')).toEqual({ path: 'a.ts' });
    expect(parseReadSpec('C:/x/a.ts:120-300')).toEqual({ path: 'C:/x/a.ts', from: 120, to: 300 });
    expect(parseReadSpec('C:/x/a.ts')).toEqual({ path: 'C:/x/a.ts' });
  });

  it('refuses a backwards or zero range', () => {
    expect(() => parseReadSpec('a.ts:5-2')).toThrow(/bad line range/);
    expect(() => parseReadSpec('a.ts:0-2')).toThrow(/bad line range/);
  });
});

describe('readFiles', () => {
  it('numbers lines and wraps each file', () => {
    const { text, files } = readFiles({ specs: ['src/a.ts', 'b.txt:2-9'], cwd: root, root });
    expect(text).toBe(
      '<file path="src/a.ts">\n     1\tone\n     2\ttwo\n     3\tthree\n</file>\n\n' +
        '<file path="b.txt" lines="2-2">\n     2\tbeta\n</file>',
    );
    expect(files).toEqual(['src/a.ts', 'b.txt:2-2']);
  });

  it('shows paths relative to the repo root when run from a subdirectory', () => {
    const { files } = readFiles({ specs: ['a.ts'], cwd: join(root, 'src'), root });
    expect(files).toEqual(['src/a.ts']);
  });

  it('refuses a missing file, a directory, a binary file and a range past the end', () => {
    writeFileSync(join(root, 'bin.dat'), 'a\0b');
    expect(() => readFiles({ specs: ['nope.ts'], cwd: root, root })).toThrow(/cannot read nope\.ts/);
    expect(() => readFiles({ specs: ['src'], cwd: root, root })).toThrow(/cannot read src: not a file/);
    expect(() => readFiles({ specs: ['bin.dat'], cwd: root, root })).toThrow(/looks binary/);
    expect(() => readFiles({ specs: ['b.txt:3-4'], cwd: root, root })).toThrow(/has 2 lines/);
  });
});
