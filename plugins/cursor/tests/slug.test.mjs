import { describe, expect, it } from 'vitest';
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

describe('jobName', () => {
  it('is the slug plus a random 4-character suffix', () => {
    const name = jobName('Add retry to FetchUser');
    expect(name).toMatch(/^add-retry-to-fetchuser-[a-z0-9]{4}$/);
  });
});
