import { describe, expect, it } from 'vitest';
import { compareVersions, updateNotice } from '../scripts/update.mjs';

describe('compareVersions', () => {
  it('orders date-stamped versions by date, numerically', () => {
    expect(compareVersions('2026.10.22-27dcf5f', '2026.10.22-27dcf5f')).toBe(0);
    expect(compareVersions('2026.10.22-27dcf5f', '2026.9.30-abc1234')).toBe(1);
    expect(compareVersions('2026.9.30-abc1234', '2026.10.22-27dcf5f')).toBe(-1);
    expect(compareVersions('2027.1.2-aaaaaaa', '2026.12.31-bbbbbbb')).toBe(1);
  });

  it('treats two builds of the same day as equal', () => {
    expect(compareVersions('2026.10.22-27dcf5f', '2026.10.22-0000000')).toBe(0);
  });
});

describe('updateNotice', () => {
  it('names the newer version and asks before updating', () => {
    const line = updateNotice({ latest: '2026.10.30-1234abc' }, '2026.10.22-27dcf5f');
    expect(line).toContain(
      'A newer Cursor CLI version is available: 2026.10.30-1234abc (installed: 2026.10.22-27dcf5f).',
    );
    expect(line).toContain('Ask the user whether to run `/cursor:update`.');
  });

  it('says nothing when cursor-agent is current, newer, or either version is unknown', () => {
    expect(updateNotice({ latest: '2026.10.22-27dcf5f' }, '2026.10.22-27dcf5f')).toBe('');
    expect(updateNotice({ latest: '2026.10.1-aaaaaaa' }, '2026.10.22-27dcf5f')).toBe('');
    expect(updateNotice(null, '2026.10.22-27dcf5f')).toBe('');
    expect(updateNotice({ latest: '2026.10.30-1234abc' }, null)).toBe('');
  });
});
