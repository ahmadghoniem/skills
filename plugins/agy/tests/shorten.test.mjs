import { describe, expect, it } from 'vitest';
import { BUDGET, describeCut, readTarget, shorten } from '../mcp/shorten.mjs';

const rgLines = (files, perFile) =>
  files.flatMap((f) => Array.from({ length: perFile }, (_, i) => `${f}:${i + 1}:    const value = compute(${i}); // ${'x'.repeat(40)}`));

describe('shorten', () => {
  it('leaves output under the budget alone', () => {
    expect(shorten('a\nb', 'p')).toBe('a\nb');
  });

  it('keeps whole lines from both ends and says which lines are missing', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1} ${'y'.repeat(60)}`);
    const out = shorten(lines.join('\n'), 'C:/tmp/x.out');
    expect(out.length).toBeLessThanOrEqual(BUDGET);
    expect(out.startsWith('line 1 ')).toBe(true);
    expect(out.endsWith(lines[499])).toBe(true);
    const [, from, to] = out.match(/lines (\d+)-(\d+) of 500 are not shown/);
    expect(out).toContain(`line ${Number(from) - 1} `);
    expect(out).not.toContain(`line ${from} `);
    expect(out).toContain(`line ${Number(to) + 1} `);
    expect(out).toContain('Full output: C:/tmp/x.out');
    expect(out).toContain(`view_file from line ${from}`);
  });

  it('counts the cut rg matches by file, Windows paths included', () => {
    const files = ['C:/repo/src/a.ts', 'C:/repo/src/b.ts', 'C:/repo/src/c.ts', 'C:/repo/src/d.ts'];
    const out = shorten(rgLines(files, 60).join('\n'), 'p');
    expect(out).toMatch(/They hold \d+ matching lines in \d+ files: C:\/repo\/src\/b\.ts \(60\)/);
  });

  it('attributes --heading output to the heading above the cut', () => {
    const before = ['src/a.ts', '1:import x'];
    expect(describeCut(['2:foo', '3:bar', '', 'src/b.ts', '9:baz'], before)).toBe(
      'They hold 3 matching lines in 2 files: src/a.ts (2), src/b.ts (1).',
    );
  });

  it('counts rg matches printed without line numbers', () => {
    expect(describeCut(['src/a.ts:  foo()', 'src/a.ts:  bar()', 'C:/repo/b.ts:baz'])).toBe(
      'They hold 3 matching lines in 2 files: src/a.ts (2), C:/repo/b.ts (1).',
    );
  });

  it('counts -C context lines with their file', () => {
    const cut = ['src/a.ts-1-a', 'src/a.ts-2-b', 'src/a.ts:3:hit', 'src/a.ts-4-c', 'src/a.ts-5-d', '--',
      'src/b.ts-7-e', 'src/b.ts-8-f', 'src/b.ts:9:hit', 'src/b.ts-10-g'];
    expect(describeCut(cut)).toBe(
      'They hold 2 matching lines (and 7 lines of context) in 2 files: src/a.ts (1), src/b.ts (1).',
    );
  });

  it('counts matches from a single file, where rg names no file', () => {
    expect(describeCut(['12-a', '13:hit', '14-b', '--', '40:hit'])).toBe('They hold 2 matching lines (and 2 lines of context).');
  });

  it('counts a cut file listing by directory, files at the root included', () => {
    expect(describeCut(['src/a.ts', 'src/b.ts', 'tests/c.ts', 'README.md'])).toBe(
      'They list 4 paths by directory: src/ (2), tests/ (1), ./ (1).',
    );
  });

  it('describes nothing for ordinary output', () => {
    expect(describeCut(['PASS tests/a.test.ts', 'Tests: 3 passed'])).toBe('');
    expect(describeCut(['✓ tests/a.test.ts (3 tests)', '✓ tests/b.test.ts (1 test)'])).toBe('');
  });

  it('cuts a single huge line to its start', () => {
    const out = shorten('z'.repeat(50_000), 'p');
    expect(out.length).toBeLessThanOrEqual(BUDGET);
    expect(out).toContain('this output is 50000 characters on 1 line');
  });

  it('points a cut file print at the file itself', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `code ${i + 1} ${'q'.repeat(60)}`);
    const out = shorten(lines.join('\n'), 'p', BUDGET, { read: { file: 'C:/repo/a.ts', first: 101 } });
    const [, from, to] = out.match(/lines (\d+)-(\d+) of 400 are not shown/);
    expect(out).toContain(`This is C:/repo/a.ts: read its lines ${Number(from) + 100}-${Number(to) + 100} with view_file`);
    expect(out).not.toContain('Full output');
  });

  it('shortens labelled sections separately, keeping the short ones whole', () => {
    const big = Array.from({ length: 300 }, (_, i) => `src/a.ts:${i + 1}:${'w'.repeat(60)}`);
    const small = ['src/b.ts:1:one', 'src/b.ts:2:two'];
    const lines = ['== big', ...big, '== small', ...small];
    const out = shorten(lines.join('\n'), 'p');
    expect(out.length).toBeLessThanOrEqual(BUDGET + 1000);
    expect(out).toContain(['== small', ...small].join('\n'));
    const [, from, to] = out.match(/lines (\d+)-(\d+) of 304 are not shown/);
    expect(lines[Number(from) - 2]).toBe(out.split('\n')[Number(from) - 2]);
    expect(Number(to)).toBeLessThan(302);
  });
});

describe('readTarget', () => {
  it('finds the file a command only prints', () => {
    expect(readTarget('cat packages/a.ts')).toEqual({ file: 'packages/a.ts', first: 1 });
    expect(readTarget("sed -n '120,170p' 'src/b c.ts' ;")).toEqual({ file: 'src/b c.ts', first: 120 });
    expect(readTarget('head -n 50 src/c.ts')).toEqual({ file: 'src/c.ts', first: 1 });
  });

  it('ignores anything more than a plain print', () => {
    expect(readTarget('cat a.ts | rg x')).toBeNull();
    expect(readTarget('cat a.ts b.ts')).toBeNull();
    expect(readTarget('rg -n x src')).toBeNull();
  });
});
