#!/usr/bin/env node
// Checks the chair's report before it goes to the user: every OPEN dispute in
// disputes.md must appear in report.md word for word, so none is dropped or
// reworded on the way.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { councilDir } from './lib/council.mjs';
import { parseCli, runAsScript } from '../scripts/lib/shared/proc.mjs';

const USAGE = 'Usage: check.mjs --council <name>\n';

const normalize = (s) => String(s).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();

/**
 * The OPEN disputes in a dispute log. A dispute is a `### D<n>` heading and
 * everything under it up to the next heading; it is open when its heading says OPEN.
 */
export function openDisputes(log) {
  const lines = normalize(log).split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^###\s+D\d+\b/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !/^#{1,3}\s/.test(lines[j])) j++;
    if (/\bOPEN\b/.test(lines[i])) found.push({ id: lines[i].match(/D\d+/)[0], text: lines.slice(i, j).join('\n').trim() });
    i = j - 1;
  }
  return found;
}

/** @param {string[]} argv */
export async function main(argv) {
  let values;
  try {
    ({ values } = parseCli(argv, { council: { type: 'string' }, help: { type: 'boolean' } }));
  } catch (err) {
    return process.stderr.write(`Error: ${err.message}\n${USAGE}`), 2;
  }
  if (values.help) return process.stdout.write(USAGE), 0;
  if (!values.council) return process.stderr.write(`Error: --council is required.\n${USAGE}`), 2;
  const dir = councilDir(values.council);
  const report = join(dir, 'report.md');
  if (!existsSync(report)) return process.stderr.write(`Error: write the report to ${report} first.\n`), 2;
  const log = join(dir, 'disputes.md');
  const open = existsSync(log) ? openDisputes(readFileSync(log, 'utf8')) : [];
  const text = normalize(readFileSync(report, 'utf8'));
  const missing = open.filter((d) => !text.includes(d.text));
  if (missing.length) {
    process.stdout.write(`✗ ${missing.length} of ${open.length} OPEN dispute(s) are not in report.md word for word: ${missing.map((d) => d.id).join(', ')}. Copy each from disputes.md unchanged.\n`);
    return 1;
  }
  process.stdout.write(`✓ All ${open.length} OPEN dispute(s) are in report.md word for word.\n`);
  return 0;
}

runAsScript(import.meta.url, main);
