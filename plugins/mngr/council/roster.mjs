#!/usr/bin/env node
// The roster shown before a council starts: each seat's kind, exact model,
// effort, CLI version, and its quota. There are no standing seats: every
// council names its own. `--approve` records the roster the user said go to;
// round 1 refuses to start without it. agy reports what is left headless
// (`agy -p /usage --output-format json`, which spends no tokens). grok's
// `grok usage` refuses outside its app, so the roster reads the billing
// endpoint the app reads, with grok's own sign-in (the way T3 Code does).
// opencode has no subscription window, so for it the last quota error mngr
// recorded is what there is.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readCouncil, rosterOf, writeCouncil } from './lib/council.mjs';
import { delegatePath, MEMBERS, modelOf } from './lib/members.mjs';
import { parseCli, run, runAsScript } from '../scripts/lib/shared/proc.mjs';
import { parseVersion } from '../scripts/lib/shared/release.mjs';
import { readQuota } from '../scripts/lib/shared/quota.mjs';

function effortOf(seat) {
  if (seat.member === 'grok') return seat.effort ?? 'medium';
  const m = /-(low|medium|high|xhigh|max)$|#(\w+)$/.exec(modelOf(seat));
  return m ? m[1] ?? m[2] : 'default';
}

function lastErrorOf(seat) {
  const key = modelOf(seat);
  const e = readQuota(join(MEMBERS[seat.member].home(), 'quota.json'))[key];
  if (!e) return 'no quota error on record';
  const resets = e.resetsAt ? (Date.parse(e.resetsAt) > Date.now() ? `, blocked until ${e.resetsAt.slice(0, 16).replace('T', ' ')} UTC` : ', reset since') : '';
  return `last error ${e.at.slice(0, 16).replace('T', ' ')} UTC: ${e.message.slice(0, 90)}${resets}`;
}

/**
 * What agy has left for the model's group (Gemini models, or Claude and GPT
 * models), from the JSON `agy -p /usage --output-format json` prints. Null
 * when the group isn't there.
 *
 * @param {any} usage
 * @param {string} model
 */
export function agyQuotaLeft(usage, model) {
  const gemini = /gemini/i.test(model);
  const group = (usage?.command?.data?.groups ?? []).find((g) => /gemini/i.test(g.name) === gemini);
  if (!group?.buckets?.length) return null;
  const bucket = (b) => {
    const pct = `${Math.floor(Number(b.remaining_fraction) * 100)}% ${b.window === '5h' ? '5-hour' : b.window}`;
    return Number(b.remaining_fraction) < 1 && Date.parse(b.reset_time) > 0 ? `${pct} (full ${b.reset_time.slice(0, 16).replace('T', ' ')} UTC)` : pct;
  };
  return `left: ${group.buckets.map(bucket).join(', ')}`;
}

async function agyUsage() {
  const r = await run(process.env.COUNCIL_AGY_CLI ?? MEMBERS.agy.cli, ['-p', '/usage', '--output-format', 'json'], { timeoutMs: 30_000 });
  try {
    return r.exitCode === 0 ? JSON.parse(r.stdout) : null;
  } catch {
    return null;
  }
}

/**
 * What grok has left this period, from the billing endpoint's JSON. The credit
 * is shared by Grok Build and Grok chat, so chat use counts against a seat
 * too. Null when the response has no period.
 *
 * @param {any} billing
 */
export function grokQuotaLeft(billing) {
  const c = billing?.config;
  const used = Number(c?.creditUsagePercent);
  if (!c?.currentPeriod || !Number.isFinite(used)) return null;
  const left = Math.max(0, Math.floor(100 - used));
  const window = /WEEKLY/.test(c.currentPeriod.type ?? '') ? 'weekly' : 'this period';
  const end = Date.parse(c.currentPeriod.end);
  const full = left < 100 && end > 0 ? ` (full ${new Date(end).toISOString().slice(0, 16).replace('T', ' ')} UTC)` : '';
  return `left: ${left}% ${window}${full}`;
}

/**
 * One read of grok's billing, with the newest unexpired sign-in in
 * `~/.grok/auth.json` (`COUNCIL_GROK_HOME` overrides the folder). Null on any
 * failure; the token never leaves this request.
 *
 * @param {string} version grok's version, sent the way the app sends it
 */
async function grokUsage(version) {
  let key;
  try {
    const auth = JSON.parse(readFileSync(join(process.env.COUNCIL_GROK_HOME ?? join(homedir(), '.grok'), 'auth.json'), 'utf8'));
    const expiry = (e) => Date.parse(e.expires_at) || Infinity;
    key = Object.values(auth)
      .filter((e) => typeof e?.key === 'string' && expiry(e) > Date.now())
      .sort((a, b) => expiry(b) - expiry(a))[0]?.key;
  } catch {
    return null;
  }
  if (!key) return null;
  try {
    const r = await fetch('https://cli-chat-proxy.grok.com/v1/billing?format=credits', {
      headers: { Authorization: `Bearer ${key}`, 'x-grok-client-version': version, 'x-grok-client-surface': 'grok-build' },
      signal: AbortSignal.timeout(15_000),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** @param {string[]} argv */
export async function main(argv) {
  let values;
  try {
    ({ values } = parseCli(argv, { council: { type: 'string' }, approve: { type: 'boolean' } }));
  } catch (err) {
    return process.stderr.write(`Error: ${err.message}\n`), 2;
  }
  if (!values.council) return process.stderr.write('Error: name the council: --council <name>. There are no standing seats.\n'), 2;
  let council;
  try {
    council = readCouncil(values.council);
  } catch (err) {
    return process.stderr.write(`Error: ${err.message}\n`), 2;
  }
  const { seats } = council;
  const versions = Object.fromEntries(
    await Promise.all(
      [...new Set(seats.map((s) => s.member))].map(async (m) => {
        const r = await run(process.env[`COUNCIL_${m.toUpperCase()}_CLI`] ?? MEMBERS[m].cli, ['--version'], { timeoutMs: 20_000 });
        return [m, r.exitCode === 0 ? parseVersion(r.stdout + r.stderr) ?? '?' : 'not found'];
      }),
    ),
  );
  const has = (m) => seats.some((s) => s.member === m);
  const [usage, billing] = await Promise.all([has('agy') ? agyUsage() : null, has('grok') ? grokUsage(versions.grok) : null]);
  const quotaOf = (s) => {
    const left = s.member === 'agy' ? agyQuotaLeft(usage, modelOf(s)) : s.member === 'grok' ? grokQuotaLeft(billing) : null;
    return left ? `${left}; ${lastErrorOf(s)}` : lastErrorOf(s);
  };
  const rows = [
    '| Seat | Kind | Member | Model | Effort | CLI | Quota |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...seats.map((s) =>
      `| ${s.name} | ${s.auditor ? 'auditor' : 'core'} | ${s.member}${delegatePath(s.member) ? '' : ' (no delegate script)'} | ${modelOf(s)} | ${effortOf(s)} | ${versions[s.member]} | ${quotaOf(s)} |`,
    ),
  ];
  process.stdout.write(`${rows.join('\n')}\n`);
  if (values.approve) {
    council.approved = rosterOf(seats);
    writeCouncil(council);
    process.stdout.write('\nApproved: round 1 can start with these seats and models.\n');
  }
  return 0;
}

runAsScript(import.meta.url, main);
