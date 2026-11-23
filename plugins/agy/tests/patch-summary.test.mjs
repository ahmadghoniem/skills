import { describe, expect, it } from 'vitest';
import { lineDelta, summarizePatch } from '../mcp/patch-summary.mjs';

describe('lineDelta', () => {
  it('counts an insertion', () => {
    expect(lineDelta('a\nb\nc\n', 'a\nb\nx\ny\nc\n')).toEqual({ add: 2, del: 0, approx: false });
  });

  it('counts a changed line as one added and one removed', () => {
    expect(lineDelta('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ add: 1, del: 1, approx: false });
  });

  it('counts changes at both ends of the file', () => {
    expect(lineDelta('a\nb\nc\nd\n', 'z\nb\nc\ne\n')).toEqual({ add: 2, del: 2, approx: false });
  });

  it('ignores CRLF against LF', () => {
    expect(lineDelta('a\r\nb\r\n', 'a\nb\n')).toEqual({ add: 0, del: 0, approx: false });
  });
});

describe('summarizePatch', () => {
  const contents = (files) => (path) => files[path] ?? {};

  it('folds the per-block lines of one file into one line with counts', () => {
    const text = 'updated  src/a.ts #1: line 7, exact\nupdated  src/a.ts #2: line 32, exact\nok: 1 file(s)\n';
    const out = summarizePatch(text, contents({ 'src/a.ts': { before: 'x\ny\n', after: 'x\nnew\ny\n' } }));
    expect(out).toBe('updated  src/a.ts: 2 blocks (lines 7, 32), +1/-0 lines\nok: 1 file(s)\n');
  });

  it('keeps one line per file, in the order apply-patch reported them', () => {
    const text = [
      'updated  a.ts #1: line 1, exact',
      'updated  b.ts #1: line 5, exact',
      'updated  a.ts #2: line 9, exact',
      'created  c.ts (3 lines)',
      'ok: 3 file(s)',
    ].join('\n');
    const out = summarizePatch(text, contents({}));
    expect(out.split('\n')).toEqual([
      'updated  a.ts: 2 blocks (lines 1, 9)',
      'updated  b.ts: 1 block (line 5)',
      'created  c.ts (3 lines)',
      'ok: 3 file(s)',
    ]);
  });

  it('notes a block that did not match exactly, and an "all" block', () => {
    const text = 'updated  a.ts #1: line 4, matched ignoring trailing-whitespace\nupdated  a.ts #2: 3 replacements, exact\nok: 1 file(s)';
    const out = summarizePatch(text, contents({}));
    expect(out).toBe('updated  a.ts: 2 blocks (4, 3 places); #1 matched ignoring trailing-whitespace\nok: 1 file(s)');
  });

  it('leaves the command\'s other output alone', () => {
    const text = 'updated  a.ts #1: line 2, exact\nok: 1 file(s)\n\n12 tests passed\n[exit code 1]';
    const out = summarizePatch(text, contents({}));
    expect(out).toBe('updated  a.ts: 1 block (line 2)\nok: 1 file(s)\n\n12 tests passed\n[exit code 1]');
  });

  it('changes nothing when the patch did not apply', () => {
    const text = 'apply-patch: a.ts #2: SEARCH text not found.';
    expect(summarizePatch(text, contents({}))).toBe(text);
  });
});
