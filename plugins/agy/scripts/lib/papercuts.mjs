// The friction log. One JSON object per line in `~/.cad/papercuts.jsonl`,
// append-only, machine-wide. This module records; `/agy:kaizen` diagnoses.
//
// Rows copy their evidence rather than pointing at the job record:
// `pruneOlderThanDays` runs on every dispatch and permanently deletes every
// file in the job directory older than 30 days, the raw NDJSON event stream
// included. A row has to be judgeable on its own three weeks later.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { papercutsPath } from './paths.mjs';

/**
 * The plugin's own version, stamped on every cut so a cut recorded before a fix
 * shipped is distinguishable from one recorded after.
 *
 * @type {string}
 */
export const pluginVersion = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const v = JSON.parse(readFileSync(join(here, '..', '..', 'plugin.json'), 'utf8'))?.version;
    return typeof v === 'string' ? v : 'unknown';
  } catch {
    return 'unknown';
  }
})();

/**
 * Which renderer warnings become papercuts, and how each is filed.
 *
 * `agy-status` and `exit` fire on runs that worked and `resume` is an offer
 * rather than a problem, so the three of them are left out.
 *
 * `warn` means the run's output cannot be trusted as it stands; `info` means
 * something went wrong mid-run and agy carried on.
 *
 * @type {Readonly<Record<string, {severity: 'warn'|'info'}>>}
 */
export const DETECTED_WARNINGS = Object.freeze({
  stderr: { severity: 'warn' },
  'agy-error': { severity: 'warn' },
  watchdog: { severity: 'warn' },
  'tool-errors': { severity: 'info' },
});

/**
 * @typedef {Object} Papercut
 * @property {string} id
 * @property {string} ts
 * @property {'detected'|'narrated'|'orchestrator'} source
 * @property {'warn'|'info'} severity
 * @property {string} tool
 * @property {string} [toolVersion]
 * @property {string} [pluginVersion]
 * @property {string} [model]
 * @property {string} [repo]
 * @property {string} [jobId]
 * @property {string} [conversationId]
 * @property {number} [toolCalls]
 * @property {number} [filesChanged]
 * @property {string} [warningId] which ⚠ line produced this, for detected rows
 * @property {string} text
 * @property {string} [fix]
 * @property {Record<string, unknown>} [evidence]
 * @property {string} [resolves] id of a cut this one closes
 */

/**
 * Stable 8-hex handle for a cut. Hashed over the whole row including its
 * timestamp, so repeat occurrences get distinct ids and recurrence survives.
 *
 * @param {Omit<Papercut, 'id'>} cut
 * @returns {string}
 */
export function papercutId(cut) {
  return createHash('sha256').update(JSON.stringify(cut)).digest('hex').slice(0, 8);
}

/**
 * Append one cut. Never throws: a failure to log must not take down the run it
 * was logging about.
 *
 * @param {Omit<Papercut, 'id'>} cut
 * @returns {string|null} the new cut's id, or null if the write failed
 */
export function appendPapercut(cut) {
  try {
    const path = papercutsPath();
    mkdirSync(dirname(path), { recursive: true });
    const id = papercutId(cut);
    appendFileSync(path, `${JSON.stringify({ id, ...cut })}\n`, 'utf8');
    return id;
  } catch {
    return null;
  }
}

/**
 * Read the whole log. Malformed lines are skipped rather than fatal — an
 * append-only file that a crash truncated mid-line is still worth reading.
 *
 * @returns {Papercut[]}
 */
export function readPapercuts() {
  let raw;
  try {
    raw = readFileSync(papercutsPath(), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === 'object') out.push(parsed);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Evidence for one warning, drawn from the run summary. Narrow per warning
 * kind: enough to judge the row cold in three weeks, not a second copy of the
 * event stream.
 *
 * @param {string} warningId
 * @param {{line: string, detail?: string[]}} anomaly
 * @param {Record<string, unknown>} ctx run summary fields
 * @returns {Record<string, unknown>}
 */
function evidenceFor(warningId, anomaly, ctx) {
  /** @type {Record<string, unknown>} */
  const ev = { agyStatus: ctx.agyStatus ?? null, exitCode: ctx.exitCode ?? null };
  if (warningId === 'tool-errors' && Array.isArray(ctx.toolErrors)) {
    ev.toolErrors = ctx.toolErrors.slice(0, 5);
  }
  if (warningId === 'stderr' && Array.isArray(ctx.stderrTail)) {
    ev.stderrTail = ctx.stderrTail.slice(0, 10);
  }
  if (anomaly.detail?.length) ev.detail = anomaly.detail.slice(0, 5);
  return ev;
}

/**
 * Build the `detected` rows for a finished run.
 *
 * Takes the anomalies the renderer already computed, so the log and the ⚠ lines
 * the user saw cannot drift apart. Only `DETECTED_WARNINGS` ids produce rows.
 *
 * @param {{id: string, line: string, detail?: string[]}[]} anomalyList
 * @param {Record<string, unknown>} ctx
 * @returns {Omit<Papercut, 'id'>[]}
 */
export function detectedCuts(anomalyList, ctx) {
  const out = [];
  for (const a of anomalyList ?? []) {
    const spec = DETECTED_WARNINGS[a.id];
    if (!spec) continue;
    out.push({
      ts: new Date().toISOString(),
      source: 'detected',
      severity: spec.severity,
      tool: 'agy',
      toolVersion: ctx.toolVersion || undefined,
      pluginVersion: ctx.pluginVersion || undefined,
      model: ctx.model || undefined,
      repo: ctx.repo || undefined,
      jobId: ctx.jobId || undefined,
      conversationId: ctx.conversationId || undefined,
      toolCalls: typeof ctx.toolCalls === 'number' ? ctx.toolCalls : undefined,
      filesChanged: typeof ctx.filesChanged === 'number' ? ctx.filesChanged : undefined,
      warningId: a.id,
      text: a.line.split('\n')[0].trim(),
      evidence: evidenceFor(a.id, a, ctx),
    });
  }
  return out;
}

/**
 * Write the `detected` rows for a finished run. Swallows everything.
 *
 * @param {{id: string, line: string, detail?: string[]}[]} anomalyList
 * @param {Record<string, unknown>} ctx
 * @returns {number} how many cuts were written
 */
export function recordDetected(anomalyList, ctx) {
  let n = 0;
  try {
    for (const cut of detectedCuts(anomalyList, ctx)) {
      if (appendPapercut(cut)) n += 1;
    }
  } catch {
    // Logging must never fail a run.
  }
  return n;
}
