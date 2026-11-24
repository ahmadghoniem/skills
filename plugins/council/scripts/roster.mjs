#!/usr/bin/env node
// The roster shown before a council starts: each seat's kind, model, effort,
// CLI version, and the last quota error its plugin recorded for that model.
// No CLI reports remaining quota to a headless caller, so the last error is
// what there is; no cost estimate either.
import { join } from 'node:path';
import { readCouncil } from './lib/council.mjs';
import { delegatePath, MEMBERS } from './lib/members.mjs';
import { parseCli, run, runAsScript } from './lib/shared/proc.mjs';
import { parseVersion } from './lib/shared/release.mjs';
import { readQuota } from './lib/shared/quota.mjs';

/** The standing council, shown when no council is named. */
const DEFAULT_SEATS = [
  { name: 'grok', member: 'grok', effort: 'medium' },
  { name: 'neon', member: 'agy', model: 'gemini-4-neon-high' },
  { name: 'muse', member: 'opencode', model: 'meta/muse-wonder-1.0' },
];

function effortOf(seat) {
  if (seat.member === 'grok') return seat.effort ?? 'medium';
  const m = /-(low|medium|high|xhigh|max)$|#(\w+)$/.exec(seat.model ?? MEMBERS[seat.member].defaultModel);
  return m ? m[1] ?? m[2] : 'default';
}

function quotaOf(seat) {
  const key = seat.model ?? (seat.member === 'grok' ? 'default' : MEMBERS[seat.member].defaultModel);
  const e = readQuota(join(MEMBERS[seat.member].home(), 'quota.json'))[key];
  if (!e) return 'no quota error on record';
  const resets = e.resetsAt ? (Date.parse(e.resetsAt) > Date.now() ? `, blocked until ${e.resetsAt.slice(0, 16).replace('T', ' ')} UTC` : ', reset since') : '';
  return `${e.at.slice(0, 16).replace('T', ' ')} UTC: ${e.message.slice(0, 90)}${resets}`;
}

/** @param {string[]} argv */
export async function main(argv) {
  let values;
  try {
    ({ values } = parseCli(argv, { council: { type: 'string' } }));
  } catch (err) {
    return process.stderr.write(`Error: ${err.message}\n`), 2;
  }
  let seats = DEFAULT_SEATS;
  if (values.council) {
    try {
      seats = readCouncil(values.council).seats;
    } catch (err) {
      return process.stderr.write(`Error: ${err.message}\n`), 2;
    }
  }
  const versions = Object.fromEntries(
    await Promise.all(
      [...new Set(seats.map((s) => s.member))].map(async (m) => {
        const r = await run(process.env[`COUNCIL_${m.toUpperCase()}_CLI`] ?? MEMBERS[m].cli, ['--version'], { timeoutMs: 20_000 });
        return [m, r.exitCode === 0 ? parseVersion(r.stdout + r.stderr) ?? '?' : 'not found'];
      }),
    ),
  );
  const rows = [
    '| Seat | Kind | Member | Model | Effort | CLI | Last quota error |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...seats.map((s) =>
      `| ${s.name} | ${s.auditor ? 'auditor' : 'core'} | ${s.member}${delegatePath(s.member) ? '' : ' (plugin not installed)'} | ${s.model ?? MEMBERS[s.member].defaultModel} | ${effortOf(s)} | ${versions[s.member]} | ${quotaOf(s)} |`,
    ),
  ];
  process.stdout.write(`${rows.join('\n')}\n`);
  return 0;
}

runAsScript(import.meta.url, main);
