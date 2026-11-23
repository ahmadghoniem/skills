// The last quota error each model hit, per plugin (`~/.cgd`, `~/.cad`, `~/.cod`
// quota.json). None of the three CLIs reports remaining quota to a headless
// caller (`grok usage` refuses outside grok, agy and opencode have no command),
// so this is what a run learns the hard way, kept for the next one:
//
// - a dispatch to a model whose quota error named a reset time still ahead is
//   refused before the CLI starts, instead of failing a minute in;
// - the council's roster shows each seat's last quota error.
//
// A run that finishes clears its model's entry. See proc.mjs for how this file
// reaches each plugin.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const QUOTA = /quota|usage limit|usage balance|rate.?limit|payment required|resource.?exhausted|\b402\b|\b429\b/i;

export const isQuotaError = (text) => QUOTA.test(String(text ?? ''));

/** `Resets in 3h25m10s` / `try again in 45m` → milliseconds, or null. */
export function parseResetMs(text) {
  const m = /(?:resets?|again|retry)\s+(?:in|after)\s+((?:\d+\s*[hms]\s*)+)/i.exec(String(text ?? ''));
  if (!m) return null;
  let ms = 0;
  for (const [, n, unit] of m[1].matchAll(/(\d+)\s*([hms])/gi)) ms += Number(n) * { h: 3_600_000, m: 60_000, s: 1_000 }[unit.toLowerCase()];
  return ms || null;
}

/** Every model's last quota error: `{[model]: {at, message, resetsAt|null}}`. */
export function readQuota(path) {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function write(path, all) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  } catch {
    // a missed write only loses a hint
  }
}

/** After a run: remember a quota error, or forget the model's last one when the run got through. */
export function noteRun(path, model, error, now = Date.now()) {
  const all = readQuota(path);
  if (error && isQuotaError(error)) {
    const reset = parseResetMs(error);
    all[model] = { at: new Date(now).toISOString(), message: String(error).split('\n')[0].slice(0, 300), resetsAt: reset ? new Date(now + reset).toISOString() : null };
  } else if (!error && all[model]) {
    delete all[model];
  } else {
    return;
  }
  write(path, all);
}

/** The entry that blocks a dispatch to `model` now, or null: only one whose reset time is still ahead. */
export function quotaBlock(path, model, now = Date.now()) {
  const e = readQuota(path)[model];
  return e?.resetsAt && Date.parse(e.resetsAt) > now ? e : null;
}

/** The refusal printed instead of starting the CLI. */
export const blockedMessage = (tool, model, e) =>
  `${tool} refused ${model} before starting: "${e.message}" (${e.at.slice(0, 16).replace('T', ' ')} UTC), resets ${e.resetsAt.slice(0, 16).replace('T', ' ')} UTC. Pick another model, or wait.\n`;
