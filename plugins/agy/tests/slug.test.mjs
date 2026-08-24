import { describe, expect, it } from 'vitest';
import { shortSuffix } from '../scripts/lib/id.mjs';
import { jobName, kebabSlug } from '../scripts/lib/slug.mjs';

describe('kebabSlug', () => {
  it('slugs the leading words of a task', () => {
    expect(kebabSlug('Add retry to FetchUser')).toBe('add-retry-to-fetchuser');
  });

  it('strips punctuation and collapses separators', () => {
    expect(kebabSlug('Fix the API (retry)!')).toBe('fix-the-api-retry');
  });

  it('falls back to `task` for empty / non-alphanumeric input', () => {
    expect(kebabSlug('')).toBe('task');
    expect(kebabSlug('   ')).toBe('task');
    expect(kebabSlug('!!!')).toBe('task');
  });

  it('caps length so a long brief still yields a usable name', () => {
    const slug = kebabSlug(
      'Add retry to FetchUser and also rewrite the whole networking stack while you are at it please',
    );
    expect(slug.startsWith('add-retry-to-fetchuser')).toBe(true);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe('shortSuffix / jobName', () => {
  it('emits a 4-char lowercase alphanumeric suffix', () => {
    const s = shortSuffix(4);
    expect(s).toMatch(/^[a-z0-9]{4}$/);
  });

  it('builds names of the form slug-suffix', () => {
    const name = jobName('Add retry to FetchUser', 'a7f3');
    expect(name).toBe('add-retry-to-fetchuser-a7f3');
  });

  it('random names still match the resolver pattern', () => {
    const name = jobName('Add retry to FetchUser');
    expect(name).toMatch(/^add-retry-to-fetchuser-[a-z0-9]{4}$/);
  });
});
