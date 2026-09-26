// Presentation shared by the foreground dispatch and `/agy:result`, so the
// write-up you see when a job finishes and the one you fetch later cannot drift.
//
// Default output is agy's own report. Status and exit code are separate facts
// that can raise individual warning lines rather than being collapsed into a
// single pass/fail verdict.

import { cachedModels } from './agy.mjs'; // no cycle: agy.mjs does not import render.mjs

/** Beyond this many distinct tool failures the list stops being readable. */
const TOOL_ERROR_LIMIT = 3;

/** How many continuation lines of agy's `error` survive before truncation. */
const ERROR_TAIL_LIMIT = 4;

/**
 * agy's tool errors are frequently multi-line (a permission refusal repeats the
 * whole command). The first line carries the fact; the rest is restatement.
 *
 * @param {unknown} message
 * @returns {string}
 */
function firstLine(message) {
  return String(message ?? '').split('\n')[0].trim();
}

/**
 * @typedef {Object} ResultView
 * @property {string} id
 * @property {string|undefined} [status]
 * @property {string|null|undefined} agyStatus
 * @property {number|null|undefined} exitCode
 * @property {string|null|undefined} error
 * @property {number|undefined} durationSeconds
 * @property {string|undefined} conversationId
 * @property {string|undefined} summary
 * @property {boolean} [killed]
 * @property {boolean} [timedOut]
 * @property {string} [timedOutAfter]
 * @property {number} [compactions]
 * @property {string[]} [deniedActions]
 * @property {string[]} [readOnlyWrites] `git status` lines that appeared during a `--read-only` run
 * @property {string[]} [stderrTail]
 * @property {{tool: string, message: string}[]} [toolErrors]
 */

/**
 * Every warning kind this module can emit, in the order they are printed.
 *
 * Machine-readable list of warning ids in print order, documented in
 * `contract.md` at the plugin root and verified by `tests/contract.test.mjs`.
 *
 * @type {readonly string[]}
 */
export const WARNING_IDS = Object.freeze([
  "agy-status",
  "exit",
  "stderr",
  "tool-errors",
  "compaction",
  "denied",
  "read-only",
  "agy-error",
  "watchdog",
  "timeout",
  "resume",
]);

/**
 * Report whether a write-up exists, to disambiguate non-SUCCESS statuses
 * without judging the run.
 *
 * @param {ResultView} job
 * @returns {string}
 */
function statusContext(job) {
  const hasReport = job.summary != null && String(job.summary).trim() !== '';
  return hasReport ? ' (write-up present)' : ' (no write-up)';
}

/**
 * @typedef {Object} Anomaly
 * @property {string} id       one of `WARNING_IDS`
 * @property {string} line     the ⚠ line, without its marker
 * @property {string[]} [detail] indented continuation lines
 */

/**
 * agy 1.2.6+ exits 3 when a turn ends on a model or agent API error, even
 * after streaming part of a response, and prints an `AGY_ERROR: {...}` line.
 */
const AGY_API_ERROR_EXIT = 3;

/**
 * Whether the run ended before agy finished: the plugin's own record says so
 * (`failed`, `cancelled`, `orphaned`), the watchdog killed it, agy hit its own
 * print timeout, agy's own status says `ERROR`, or agy exited on an API error.
 * One definition shared by the resume offer, the exit code, and the
 * watchdog/timeout lines — they used to diverge.
 *
 * @param {ResultView} job
 * @returns {boolean}
 */
export function isUnfinished(job) {
  return (
    job.status === 'failed' ||
    job.status === 'cancelled' ||
    job.status === 'orphaned' ||
    Boolean(job.killed) ||
    Boolean(job.timedOut) ||
    String(job.agyStatus ?? '').toUpperCase() === 'ERROR' ||
    job.exitCode === AGY_API_ERROR_EXIT
  );
}

/**
 * The anomalies for a finished job, in the order they are printed. Exported for
 * the tests and for the papercut writer, which files the same detections the
 * renderer prints.
 *
 * @param {ResultView} job
 * @returns {Anomaly[]}
 */
export function anomalies(job) {
  /** @type {Anomaly[]} */
  const out = [];

  const status = job.agyStatus == null ? '' : String(job.agyStatus);
  if (status && status.toUpperCase() !== 'SUCCESS') {
    out.push({ id: 'agy-status', line: `agy status: ${status}${statusContext(job)}` });
  }

  if (typeof job.exitCode === 'number' && job.exitCode !== 0) {
    out.push({ id: 'exit', line: `exit ${job.exitCode}` });
  }

  // agy is silent on stderr when nothing went wrong, so any output there is
  // worth showing: initialisation failures, its own timeout notice,
  // background-task notes, and network errors on a run that did return a
  // status.
  const stderrTail = Array.isArray(job.stderrTail) ? job.stderrTail : [];
  if (stderrTail.length > 0) {
    out.push({
      id: 'stderr',
      line: 'agy wrote to stderr:',
      detail: [...stderrTail],
    });
  }

  // Tools that failed during the run, deduped across repeated attempts.
  // Highlights failed verification commands that might otherwise be masked
  // by SUCCESS.
  const toolErrors = Array.isArray(job.toolErrors) ? job.toolErrors : [];
  if (toolErrors.length > 0) {
    const seen = new Set();
    const unique = [];
    for (const e of toolErrors) {
      const key = `${e?.tool}\0${e?.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(e);
    }
    const shown = unique.slice(0, TOOL_ERROR_LIMIT);
    const noun = unique.length === 1 ? 'tool call' : 'tool calls';
    const detail = shown.map((e) => `${e.tool}: ${firstLine(e.message)}`);
    if (unique.length > shown.length) {
      detail.push(`… and ${unique.length - shown.length} more`);
    }
    out.push({
      id: 'tool-errors',
      line: `${unique.length} ${noun} failed during the run — reported, not judged:`,
      detail,
    });
  }

  // Information about the run, not friction, so it is not filed as a
  // papercut. It matters because work after a compaction is where agy is
  // most likely to redo something or drift from the brief.
  const compactions = typeof job.compactions === 'number' ? job.compactions : 0;
  if (compactions > 0) {
    out.push({
      id: 'compaction',
      line: `agy compacted its context ${compactions} time${compactions === 1 ? '' : 's'} during this run; check the diff against the brief`,
    });
  }

  // Empty on every run the plugin makes, since it passes
  // `--dangerously-skip-permissions`. Kept as a guard: if agy ever does skip a
  // tool action, the caller sees which one instead of a silent gap.
  const denied = Array.isArray(job.deniedActions) ? job.deniedActions : [];
  if (denied.length > 0) {
    out.push({
      id: 'denied',
      line: `agy skipped ${denied.length} action${denied.length === 1 ? '' : 's'} it was not allowed to take:`,
      detail: denied.map((d) => `  ${d}`),
    });
  }

  const written = Array.isArray(job.readOnlyWrites) ? job.readOnlyWrites : [];
  if (written.length > 0) {
    out.push({
      id: 'read-only',
      line: 'this read-only run changed files in the workspace:',
      detail: written.map((f) => `  ${f}`),
    });
  }

  if (job.error != null && String(job.error).length > 0) {
    const errText = String(job.error);
    const errLines = errText.split('\n');
    let detail;
    if (/invalid model selection/i.test(errText) && /not recognized/i.test(errText)) {
      // agy's own message names display labels ("Gemini 3.8 Flash (High)"),
      // which cannot be passed back to `--model`; the cache is the source of
      // truth for ids that can. An `--effort` mismatch is not about the id,
      // and agy's message already names the levels the model has.
      const models = cachedModels() ?? [];
      detail = ['Valid ids:', ...models.map((m) => `  ${m.id}`)];
    } else {
      // Error messages can be long; display the first line and truncate details.
      const extras = errLines.slice(1);
      detail = extras.slice(0, ERROR_TAIL_LIMIT);
      if (extras.length > ERROR_TAIL_LIMIT) {
        detail.push(`… ${extras.length - ERROR_TAIL_LIMIT} more lines (full text in the job log)`);
      }
    }
    out.push({ id: 'agy-error', line: errLines[0], detail });
  }

  if (job.killed) {
    out.push({
      id: 'watchdog',
      line: 'watchdog killed the run — print-timeout plus 60s grace elapsed',
    });
  }

  if (job.timedOut) {
    out.push({
      id: 'timeout',
      line: `agy hit its print timeout after ${job.timedOutAfter ?? 'its limit'}; the output is partial`,
    });
  }

  // Offer resume whenever the run ended before agy finished and kept a
  // conversation to continue, whatever stopped it (agy's own timeout, the
  // watchdog, a dropped connection, a quota error) — not only a watchdog kill.
  if (isUnfinished(job) && job.conversationId) {
    out.push({
      id: 'resume',
      line: `this run can be resumed where it stopped: /agy:resume ${job.id}`,
    });
  }

  return out;
}

/**
 * agy's report, plus a warning line per way the run may have gone wrong.
 * A clean run renders as the report alone.
 *
 * @param {ResultView} job
 * @returns {string}
 */
export function renderResult(job) {
  const report = (job.summary == null ? '' : String(job.summary)).replace(/\s+$/, '');
  const warnings = anomalies(job);

  const lines = [];
  if (report.length > 0) lines.push(report);
  else if (warnings.length === 0) lines.push('(agy returned no report)');

  if (warnings.length > 0) {
    if (lines.length > 0) lines.push('');
    for (const w of warnings) {
      lines.push(`⚠ ${w.line}`);
      for (const d of w.detail ?? []) lines.push(`  ${d}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
