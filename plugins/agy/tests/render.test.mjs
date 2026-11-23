import { describe, expect, it } from 'vitest';
import { anomalies, isUnfinished, renderResult } from '../scripts/lib/render.mjs';

const clean = { agyStatus: 'SUCCESS', exitCode: 0, response: 'Report.', conversationId: 'c1' };

describe('renderResult', () => {
  it('is the report and the conversation id on a clean run', () => {
    expect(renderResult(clean)).toBe('Report.\n\nconversation: c1\n');
    expect(isUnfinished(clean)).toBe(false);
  });
  it('keeps status and exit code as separate lines', () => {
    const ids = anomalies({ ...clean, agyStatus: 'ERROR', exitCode: 3 }).map((a) => a.id);
    expect(ids).toEqual(['agy-status', 'exit']);
  });
  it('truncates a long error and says how much was dropped', () => {
    const [a] = anomalies({ ...clean, error: ['first', '2', '3', '4', '5', '6', '7'].join('\n') });
    expect(a.line).toBe('first');
    expect(a.detail.at(-1)).toBe('… 2 more lines');
  });
  it('says so when agy returned nothing', () => {
    expect(renderResult({ agyStatus: 'SUCCESS', exitCode: 0 })).toBe('(agy returned no report)\n');
  });
});
