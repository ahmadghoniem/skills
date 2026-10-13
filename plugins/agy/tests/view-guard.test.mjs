import { describe, expect, it } from 'vitest';
import { decide, forgetStep, lineEnds, shownRange, unseen } from '../agy-agents/view-guard/view-guard.mjs';

const text = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const fresh = () => ({ files: {}, log: [] });
const call = (over) => ({ path: 'C:/r/a.js', size: 1, mtimeMs: 1, text: text(1000), step: 1, ...over });

describe('view-guard', () => {
  it('counts lines without the trailing newline', () => {
    expect(lineEnds(text(50))).toHaveLength(50);
  });

  it('caps a view at 800 lines', () => {
    expect(shownRange(lineEnds(text(1000)))).toEqual([1, 800]);
  });

  it('splits a range around seen parts', () => {
    expect(unseen([1, 100], [[20, 30]])).toEqual([[1, 19], [31, 100]]);
    expect(unseen([20, 30], [[1, 100]])).toEqual([]);
  });

  it('widens a window on an unseen small file to the whole file', () => {
    const out = decide(fresh(), call({ text: text(300), start: 40, end: 70 }));
    expect(out).toEqual({ decision: 'allow', overwrite: { StartLine: 1, EndLine: 300 } });
  });

  it('denies a range already shown, naming the step', () => {
    const s = fresh();
    decide(s, call({ start: 1, end: 200, step: 3 }));
    const out = decide(s, call({ start: 50, end: 120, step: 7 }));
    expect(out.decision).toBe('deny');
    expect(out.reason).toContain('step 3');
  });

  it('trims a partly seen range to the new lines', () => {
    const s = fresh();
    decide(s, call({ start: 1, end: 200 }));
    expect(decide(s, call({ start: 150, end: 300, step: 2 }))).toEqual({
      decision: 'allow',
      overwrite: { StartLine: 201, EndLine: 300 },
    });
  });

  it('allows a re-read after the file changed', () => {
    const s = fresh();
    decide(s, call({ start: 1, end: 200 }));
    expect(decide(s, call({ start: 1, end: 200, mtimeMs: 2, step: 2 }))).toEqual({ decision: 'allow' });
  });

  it('forgets a failed view', () => {
    const s = fresh();
    decide(s, call({ start: 1, end: 200, step: 4 }));
    forgetStep(s, 4);
    expect(decide(s, call({ start: 1, end: 200, step: 5 })).decision).toBe('allow');
  });
});
