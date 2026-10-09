import { describe, expect, it } from 'vitest';
import { BUDGET, describeCut, shorten } from '../mcp/shorten.mjs';

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

  it('counts a cut file listing by directory', () => {
    expect(describeCut(['src/a.ts', 'src/b.ts', 'tests/c.ts'])).toBe(
      'They list 3 paths by directory: src/ (2), tests/ (1).',
    );
  });

  it('describes nothing for ordinary output', () => {
    expect(describeCut(['PASS tests/a.test.ts', 'Tests: 3 passed'])).toBe('');
  });

  it('cuts a single huge line to its start', () => {
    const out = shorten('z'.repeat(50_000), 'p');
    expect(out.length).toBeLessThanOrEqual(BUDGET);
    expect(out).toContain('this output is 50000 characters on 1 line');
  });
});
