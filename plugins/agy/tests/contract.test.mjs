// Guards the link between the warnings the renderer can emit and the prose that
// explains them in `skills/output-contract/SKILL.md`.
//
// This exists because the two drifted in practice: two new warning kinds shipped
// and none of the four files documenting the contract were touched, so the
// orchestrator was reading a description of an older plugin than the one
// installed. A registry plus this test turns "remember to update the docs" into
// a red test.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WARNING_IDS } from '../scripts/lib/render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CONTRACT = join(here, '..', 'skills', 'output-contract', 'contract.md');

/** The ids the SKILL.md registry table documents, in table order. */
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

  it('has no duplicate ids', () => {
    expect(new Set(WARNING_IDS).size).toBe(WARNING_IDS.length);
  });

  it('names the registry in the prose, so the next author finds it', () => {
    expect(readFileSync(CONTRACT, 'utf8')).toContain('WARNING_IDS');
  });
});
