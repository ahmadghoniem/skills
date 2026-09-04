// The friction log. One JSON object per line in `~/.cad/papercuts.jsonl`,
// append-only, never rewritten in place.
//
// Why a log and not a fix: the model that just hit a problem is the worst
// available judge of why it happened, so this module records and does not
// diagnose. Diagnosis is `/agy:kaizen`, later, with fresh context and the whole
// cluster in view. One cut is noise; three of the same kind is a pattern.
//
// Why the evidence is copied rather than referenced: `pruneOlderThanDays` runs
// on every dispatch and `unlinkSync`s — permanently deletes — every file in the
// job directory older than 30 days. That sweep takes the raw NDJSON event
// stream with it, because unlike `listJobs` the prune does not filter by
// extension. Whatever a cut did not copy is gone at 30 days, so a cut has to
// stand on its own: you must be able to judge it without re-running the
// delegation, which costs quota and may not reproduce anyway.
//
// Machine-wide, not per-repo. Patterns cross repositories, and a per-repo log
// would be pruned by the same sweep it exists to outlive.
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
 * A deliberate subset. `agy-status` and `exit` are omitted because agy's own
 * verdict and the process exit code are documented to disagree with reality in
 * both directions — they fire constantly on runs that worked, and a log full of
 * them clusters into nothing. `resume` is omitted because it is an offer, not a
 * problem.
 *
 * The severity is the only judgement made here, and it is a coarse one: `warn`
 * means the run's output cannot be trusted as it stands, `info` means something
 * went wrong mid-run and agy carried on.
 *
 * @type {Readonly<Record<string, {severity: 'warn'|'info'}>>}
 */
export const DETECTED_WARNINGS = Object.freeze({
  wander: { severity: 'warn' },
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
 * Stable 8-hex handle for a cut. Content-addressed over the whole row including
 * its timestamp, so two occurrences of the same problem get different ids —
 * recurrence is what tells you a fix did not work, and dedup would erase it.
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
 * Evidence for one warning, drawn from the run summary rather than re-derived.
 *
 * Deliberately narrow per warning kind. The point is a row you can judge cold
 * in three weeks, not a copy of the event stream.
 *
 * @param {string} warningId
 * @param {{line: string, detail?: string[]}} anomaly
 * @param {Record<string, unknown>} ctx run summary fields
 * @returns {Record<string, unknown>}
 */
function evidenceFor(warningId, anomaly, ctx) {
  /** @type {Record<string, unknown>} */
  const ev = { agyStatus: ctx.agyStatus ?? null, exitCode: ctx.exitCode ?? null };
  if (warningId === 'wander') {
    // The smoking gun. `scratchPaths` are the paths agy actually wrote to, and
    // they are the difference between "it lied" and "it wrote to the wrong
    // root" — which are different fixes.
    if (Array.isArray(ctx.writeTargets) && ctx.writeTargets.length) {
      ev.writeTargets = ctx.writeTargets.slice(0, 10);
    }
    if (Array.isArray(ctx.scratchPaths) && ctx.scratchPaths.length) {
      ev.scratchPaths = ctx.scratchPaths.slice(0, 10);
    }
  }
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
 * Takes the anomalies the renderer already computed rather than re-deriving
 * them, so the log and the ⚠ lines the user saw cannot drift apart. Warnings
 * absent from `DETECTED_WARNINGS` produce nothing.
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
