// The friction log. One JSON object per line in `~/.cad/papercuts.jsonl`,
// append-only, machine-wide. This module records and groups; `/agy:update`
// reviews the open groups against each new agy release.
//
// Every cut carries a `key`, the group it belongs to: the warning id,
// `tool-errors:<tool>` for failed calls to one tool, or `narrated`. A
// resolution names a key, closing every cut in that group recorded before it,
// or a single cut's id.
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
 * Which renderer warnings become papercuts.
 *
 * `agy-status` and `exit` fire on runs that worked and `resume` is an offer
 * rather than a problem, so the three of them are left out.
 *
 * @type {readonly string[]}
 */
export const DETECTED_WARNINGS = Object.freeze(['stderr', 'agy-error', 'watchdog', 'timeout', 'tool-errors']);

/**
 * @typedef {Object} Papercut
 * @property {string} id
 * @property {string} ts
 * @property {'detected'|'narrated'|'resolution'} source
 * @property {string} [key]       the group a cut belongs to; absent on resolutions
 * @property {string} text        the failure itself: agy's error, the stderr line, the tool's message
 * @property {number} [count]     failed calls behind a `tool-errors:<tool>` cut
 * @property {string} [toolVersion]
 * @property {string} [pluginVersion]
 * @property {string} [model]
 * @property {string} [repo]
 * @property {string} [jobId]
 * @property {string} [conversationId]
 * @property {number} [toolCalls]
 * @property {string} [fix]
 * @property {Record<string, unknown>} [evidence]  `more` holds further distinct lines after `text`
 * @property {string} [resolves]  a key, or the id of one cut
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
 * A message on one line. Whole, not just its first line: agy often puts the
 * cause on the second ("invalid arguments:\n- missing properties ...").
 *
 * @param {unknown} s
 * @returns {string}
 */
function oneLine(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

/**
 * Build the `detected` rows for a finished run.
 *
 * Takes the anomalies the renderer already computed, so the log and the ⚠ lines
 * the user saw cannot drift apart. Only `DETECTED_WARNINGS` ids produce rows.
 * Failed tool calls become one row per tool, so each tool's failures group,
 * and close, on their own.
 *
 * @param {{id: string, line: string, detail?: string[]}[]} anomalyList
 * @param {Record<string, unknown>} ctx run summary fields
 * @returns {Omit<Papercut, 'id'>[]}
 */
export function detectedCuts(anomalyList, ctx) {
  const ts = new Date().toISOString();
  /**
   * @param {string} key
   * @param {string} text
   * @param {string[]} more further distinct lines, kept as evidence
   * @param {number} [count]
   */
  const row = (key, text, more, count) => ({
    ts,
    source: /** @type {const} */ ('detected'),
    key,
    text,
    count,
    toolVersion: ctx.toolVersion || undefined,
    pluginVersion: ctx.pluginVersion || undefined,
    model: ctx.model || undefined,
    repo: ctx.repo || undefined,
    jobId: ctx.jobId || undefined,
    conversationId: ctx.conversationId || undefined,
    toolCalls: typeof ctx.toolCalls === 'number' ? ctx.toolCalls : undefined,
    evidence: {
      agyStatus: ctx.agyStatus ?? null,
      exitCode: ctx.exitCode ?? null,
      more: more.length ? more : undefined,
    },
  });

  const out = [];
  for (const a of anomalyList ?? []) {
    if (!DETECTED_WARNINGS.includes(a.id)) continue;
    const toolErrors = Array.isArray(ctx.toolErrors) ? ctx.toolErrors : [];
    const stderrTail = Array.isArray(ctx.stderrTail) ? ctx.stderrTail.map(oneLine).filter(Boolean) : [];
    if (a.id === 'tool-errors' && toolErrors.length) {
      /** @type {Map<string, string[]>} */
      const byTool = new Map();
      for (const e of toolErrors) {
        const tool = String(e?.tool ?? 'unknown');
        if (!byTool.has(tool)) byTool.set(tool, []);
        byTool.get(tool).push(oneLine(e?.message));
      }
      for (const [tool, messages] of byTool) {
        const distinct = [...new Set(messages)];
        out.push(row(`tool-errors:${tool}`, distinct[0], distinct.slice(1, 4), messages.length));
      }
    } else if (a.id === 'stderr' && stderrTail.length) {
      out.push(row('stderr', stderrTail[0], stderrTail.slice(1, 10)));
    } else {
      out.push(row(a.id, oneLine(a.line), (a.detail ?? []).map(oneLine).filter(Boolean).slice(0, 5)));
    }
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

/**
 * Whether a resolution closes a cut: it names the cut's id, or the cut's key
 * and was recorded after it.
 *
 * @param {Record<string, unknown>} fix
 * @param {Record<string, unknown>} cut
 * @returns {boolean}
 */
export function closes(fix, cut) {
  return fix.resolves === cut.id || (fix.resolves === cut.key && String(fix.ts) > String(cut.ts));
}

// agy wraps a rejected tool call's error in the same ~130 characters every
// time, which pushes the cause (usually a path) to the end of the line.
const PERMISSION_WRAPPER = /^declaring permissions: cortex tool [\w-]+: convert tool call for permissions: (?:model output error: )?(?:invalid tool call error \(\w+\) )?/;

/**
 * Compare version strings by their numeric parts, so 1.2.11 sorts after 1.2.2.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function byVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * The open cuts, one block per key, largest first, plus the keys that came
 * back after a recorded fix. Empty string when nothing is open.
 *
 * @param {Record<string, unknown>[]} [all]
 * @returns {string}
 */
export function formatOpenPapercuts(all = readPapercuts()) {
  const fixes = all.filter((c) => c.resolves);
  const open = all.filter((c) => !c.resolves && !fixes.some((f) => closes(f, c)));
  if (open.length === 0) return '';

  /** @type {Map<string, Record<string, unknown>[]>} */
  const groups = new Map();
  for (const c of open) {
    const k = String(c.key);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }

  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const out = [`${open.length} open papercut${open.length === 1 ? '' : 's'} in ${ordered.length} cluster${ordered.length === 1 ? '' : 's'}:`, ''];
  for (const [key, cuts] of ordered) {
    cuts.sort((a, b) => (String(a.ts) < String(b.ts) ? 1 : -1));
    const versions = [...new Set(cuts.map((c) => String(c.toolVersion ?? '')).filter(Boolean))].sort(byVersion);
    const span = `${String(cuts.at(-1).ts).slice(0, 10)} to ${String(cuts[0].ts).slice(0, 10)}`;
    out.push(`## ${key} — ${cuts.length}×, ${span}${versions.length ? `, agy ${versions.join(' ')}` : ''}`);

    // One line per distinct message, most frequent first, naming its newest cut.
    /** @type {Map<string, Record<string, unknown>[]>} */
    const byText = new Map();
    for (const c of cuts) {
      const t = String(c.text ?? '').trim().replace(PERMISSION_WRAPPER, '');
      if (!byText.has(t)) byText.set(t, []);
      byText.get(t).push(c);
    }
    const texts = [...byText.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [text, same] of texts.slice(0, 3)) {
      const c = same[0];
      out.push(`  ${same.length}×  \`${c.id}\`  ${String(c.ts).slice(0, 10)}  ${text.slice(0, 300)}`);
      if (c.fix) out.push(`      fix: ${String(c.fix).trim()}`);
    }
    if (texts.length > 3) out.push(`  … and ${texts.length - 3} more distinct messages`);
    out.push('');
  }

  // Recurrence after a resolution is the only feedback this loop has. Every
  // open cut under a resolved key postdates the fix, or the fix would close it.
  const reappeared = [];
  for (const [key, cuts] of ordered) {
    const fix = fixes.filter((f) => f.resolves === key).sort((a, b) => (String(a.ts) < String(b.ts) ? -1 : 1)).at(-1);
    if (fix) reappeared.push(`  ${key}: ${cuts.length} new since the ${String(fix.ts).slice(0, 10)} fix (${String(fix.text ?? '').trim()})`);
  }
  if (reappeared.length) {
    out.push('Recurred after a recorded fix — the fix did not hold:', ...reappeared, '');
  }
  return out.join('\n');
}
