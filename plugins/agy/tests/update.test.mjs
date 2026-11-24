import { describe, expect, it } from 'vitest';
import { changesSince, newerChangelogEntries } from '../scripts/update.mjs';

it('newerChangelogEntries is empty when nothing is newer or the text does not parse', () => {
  expect(newerChangelogEntries('1.2.2:\n- a\n\n1.2.1:\n- b\n', '1.2.2')).toEqual([]);
  expect(newerChangelogEntries('garbage output, no version headers here', '1.2.1')).toEqual([]);
});

describe('changesSince', () => {
  const LOCAL = '1.5.14:\n- new\n\n1.5.13:\n- older\n\n1.5.10:\n- base\n';
  const UP = '## 1.5.15\n\n- newest\n\n## 1.5.14\n\n- new\n\n## 1.5.10\n\n- base\n';

  it('uses agy changelog when it lists the new version, without fetching upstream', async () => {
    let fetched = false;
    const r = await changesSince({ since: '1.5.10', newVersion: '1.5.14', local: async () => LOCAL, upstream: async () => { fetched = true; return UP; } });
    expect(r.source).toBe('`agy changelog`');
    expect(r.entries.map((e) => e.version)).toEqual(['1.5.14', '1.5.13']);
    expect(fetched).toBe(false);
  });

  it('falls back to upstream when agy changelog does not list the new version yet', async () => {
    const r = await changesSince({ since: '1.5.10', newVersion: '1.5.15', local: async () => LOCAL, upstream: async () => UP });
    expect(r.source).toMatch(/raw\.githubusercontent/);
    expect(r.entries.map((e) => e.version)).toEqual(['1.5.15', '1.5.14']);
  });

  it('falls back to upstream when agy changelog fails, and to agy when upstream is unreachable', async () => {
    let r = await changesSince({ since: '1.5.10', newVersion: '1.5.14', local: async () => null, upstream: async () => UP });
    expect(r.source).toMatch(/raw\.githubusercontent/);
    r = await changesSince({ since: '1.5.10', newVersion: '1.5.15', local: async () => LOCAL, upstream: async () => null });
    expect(r.source).toBe('`agy changelog`');
    expect(r.entries.map((e) => e.version)).toEqual(['1.5.14', '1.5.13']);
  });
});
