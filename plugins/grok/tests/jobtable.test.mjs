import { describe, expect, it } from 'vitest';
import { age, renderJobTable } from '../scripts/lib/jobtable.mjs';

describe('renderJobTable', () => {
  it('reports the empty state instead of an empty table', () => {
    expect(renderJobTable([])).toBe('No Grok jobs tracked for this repository yet.\n');
  });

  it('renders one row per job with the id in a code span', () => {
    const out = renderJobTable([
      {
        id: 'abc123',
        status: 'done',
        model: 'grok-4.6',
        startedAt: '2026-01-01T00:00:00.000Z',
        prompt: 'add retries',
      },
    ]);
    expect(out).toContain('| ID | Status | Model | Age | Prompt |');
    expect(out).toContain('`abc123`');
    expect(out).toContain('grok-4.6');
    expect(out).toContain('add retries');
  });

  it('truncates a long prompt so the table stays one line per job', () => {
    const out = renderJobTable([
      {
        id: 'x',
        status: 'done',
        model: 'm',
        startedAt: '2026-01-01T00:00:00.000Z',
        prompt: 'p'.repeat(200),
      },
    ]);
    expect(out).toContain('…');
    expect(out.split('\n')[2].length).toBeLessThan(140);
  });

  it('never lets a pipe in the prompt break the table', () => {
    const out = renderJobTable([
      {
        id: 'x',
        status: 'done',
        model: 'm',
        startedAt: '2026-01-01T00:00:00.000Z',
        prompt: 'a | b',
      },
    ]);
    expect(out).toContain('a \\| b');
  });

  it('degrades to ? for an unparseable timestamp rather than NaN', () => {
    expect(age('not-a-date')).toBe('?');
  });
});
