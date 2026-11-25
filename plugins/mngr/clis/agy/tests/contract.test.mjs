// contract.md explains each ⚠ line to Claude; this keeps it in step with the code.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WARNING_IDS } from '../scripts/lib/render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CONTRACT = join(here, '..', 'contract.md');

/** The ids contract.md's table documents, in table order. */
function documentedIds() {
  const ids = [];
  for (const line of readFileSync(CONTRACT, 'utf8').split('\n')) {
    const m = /^\|\s*`([a-z0-9-]+)`\s*\|/.exec(line);
    if (m) ids.push(m[1]);
  }
  return ids;
}

describe('the warning registry and the contract skill agree', () => {
  it('documents every id the renderer declares, in the same order', () => {
    expect(documentedIds()).toEqual([...WARNING_IDS]);
  });
});
