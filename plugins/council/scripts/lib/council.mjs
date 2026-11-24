// A council's state on disk: `~/.council/<name>/council.json` (seats, their
// sessions, the round count) and one folder per round with what each seat was
// sent and what it said.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { MEMBERS } from './members.mjs';

export const councilHome = () => (process.env.COUNCIL_HOME?.trim() ? resolve(process.env.COUNCIL_HOME) : join(homedir(), '.council'));
export const councilDir = (name) => join(councilHome(), name);

/**
 * @typedef {Object} Seat
 * @property {string} name     how the seat is called in the debate (`neon`, `grok`)
 * @property {string} member   grok | agy | opencode
 * @property {string=} model
 * @property {string=} effort  grok only: low | medium
 * @property {boolean=} auditor  runs only after the core seats converge, on frozen code
 * @property {string=} session  set by the first round it answers in
 */

/** @returns {{name: string, seats: Seat[], rounds: number, firstBrief?: string}} */
export function readCouncil(name) {
  const path = join(councilDir(name), 'council.json');
  if (!existsSync(path)) throw new Error(`no council \`${name}\`: write ${path} first (see /council:convene).`);
  const c = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(c.seats) || !c.seats.length) throw new Error(`${path} lists no seats.`);
  const names = new Set();
  for (const s of c.seats) {
    if (!MEMBERS[s.member]) throw new Error(`seat \`${s.name}\`: member must be one of ${Object.keys(MEMBERS).join(', ')}.`);
    if (!s.name || names.has(s.name)) throw new Error(`every seat needs a unique name (\`${s.name}\`).`);
    names.add(s.name);
  }
  return { rounds: 0, ...c, name };
}

export function writeCouncil(c) {
  mkdirSync(councilDir(c.name), { recursive: true });
  writeFileSync(join(councilDir(c.name), 'council.json'), `${JSON.stringify(c, null, 2)}\n`, 'utf8');
}

export const BLOCK_START = '=== FINAL ANSWER ===';
export const BLOCK_END = '=== END ===';

/** The last final-answer block in a seat's output, or null. */
export function finalBlock(text) {
  const s = String(text);
  const start = s.lastIndexOf(BLOCK_START);
  if (start < 0) return null;
  const end = s.indexOf(BLOCK_END, start);
  return s.slice(start, end < 0 ? undefined : end + BLOCK_END.length).trim();
}

/** Appended to every brief, so every seat ends the same way. */
export const ANSWER_RULES = `
---

## How to answer

This is a review. Do not modify, create or delete any file in the workspace; read,
search and run read-only commands only.

Separate what you verified (with file:line or command output) from what you infer.
Change a position you held in an earlier round only for new evidence, and name it;
another member agreeing is not evidence. Anything outside the question goes under
Out of scope, not into your position.

End your reply with exactly this block, filled in:

${BLOCK_START}
Position: <your answer in one to three sentences>
Claims checked:
- <claim>: CONFIRMED | REFUTED | UNVERIFIED (<evidence>)
Disputes:
- <id>: AGREE | DISAGREE | NEW (<evidence or reason>)
Changed since last round: <what and which new evidence, or "nothing">
Out of scope: <items for the parking lot, or "none">
${BLOCK_END}
`;
