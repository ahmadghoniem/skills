import { describe, expect, it } from 'vitest';
import { compareVersions, releasesSince, updateNotice } from '../scripts/update.mjs';

// Shaped like the `time` map of registry.npmjs.org/@xai-official/grok on
// 2026-10-14: `latest` was 1.0.52, and 1.0.53 to 1.0.58 were alpha builds.
const TIMES = {
  '1.0.50': '2026-10-06T18:00:00.000Z',
  '1.0.51': '2026-10-09T18:00:00.000Z',
  '1.0.52': '2026-10-11T18:00:00.000Z',
  '1.0.53': '2026-10-12T18:00:00.000Z',
  '1.0.58': '2026-10-14T09:00:00.000Z',
};

describe('compareVersions', () => {
  it('orders versions numerically, not lexically', () => {
    expect(compareVersions('1.0.52', '1.0.52')).toBe(0);
    expect(compareVersions('1.0.52', '1.0.6')).toBe(1);
    expect(compareVersions('1.0.6', '1.0.52')).toBe(-1);
    expect(compareVersions('1.1.0', '1.0.99')).toBe(1);
  });
});

describe('releasesSince', () => {
  it('lists the versions after the installed one up to latest, oldest first', () => {
    expect(releasesSince(TIMES, '1.0.50', '1.0.52')).toEqual([
      { version: '1.0.51', date: '2026-10-09' },
      { version: '1.0.52', date: '2026-10-11' },
    ]);
  });

  it('stops at latest, leaving out newer alpha builds', () => {
    expect(releasesSince(TIMES, '1.0.52', '1.0.52')).toEqual([]);
  });

  it('skips prerelease versions', () => {
    const times = { ...TIMES, '1.0.52-alpha.1': '2026-10-10T00:00:00.000Z' };
    expect(releasesSince(times, '1.0.51', '1.0.52').map((r) => r.version)).toEqual(['1.0.52']);
  });
});

describe('updateNotice', () => {
  const now = Date.parse('2026-10-14T12:00:00.000Z');

  it('gives the age of the latest release and the count since the installed one', () => {
    const line = updateNotice({ latest: '1.0.52', times: TIMES }, '1.0.50', now);
    expect(line).toContain('grok 1.0.52 is out (released 2 days ago); 2 releases since the installed 1.0.50.');
    expect(line).toContain('Ask the user whether to run `/grok:update`.');
  });

  it('says today for a release under a day old', () => {
    const line = updateNotice({ latest: '1.0.58', times: TIMES }, '1.0.52', now);
    expect(line).toContain('(released today)');
  });

  it('says nothing when grok is current or either version is unknown', () => {
    expect(updateNotice({ latest: '1.0.52', times: TIMES }, '1.0.52', now)).toBe('');
    expect(updateNotice({ latest: '1.0.51', times: TIMES }, '1.0.52', now)).toBe('');
    expect(updateNotice(null, '1.0.52', now)).toBe('');
    expect(updateNotice({ latest: '1.0.52', times: TIMES }, null, now)).toBe('');
  });
});
