import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WARNING_IDS } from '../scripts/lib/render.mjs';

// contract.md explains each ⚠ line to Claude; this keeps it in step with the code.
describe('contract.md', () => {
  it('documents every warning id, in print order', () => {
    const ids = [];
    for (const line of readFileSync(new URL('../contract.md', import.meta.url), 'utf8').split('\n')) {
      const m = /^\|\s*`([a-z0-9-]+)`\s*\|/.exec(line);
      if (m) ids.push(m[1]);
    }
    expect(ids).toEqual([...WARNING_IDS]);
  });
});
