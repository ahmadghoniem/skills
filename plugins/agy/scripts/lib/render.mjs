// Presentation shared by the foreground dispatch and `/agy:result`, so the
// write-up you see when a job finishes and the one you fetch later cannot drift.
//
// Default output is agy's own report. Status, exit code, and working tree
// modifications remain separate facts that can raise individual warning lines
// rather than being collapsed into a single pass/fail verdict.

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
 * @typedef {Object} GitFile
 * @property {string} status
 * @property {string} path
 */

/**
 * @typedef {Object} ResultView
 * @property {string} id
 * @property {string|null|undefined} agyStatus
 * @property {number|null|undefined} exitCode
 * @property {boolean} [gitRepo]
 * @property {GitFile[]} [gitFiles]
 * @property {string|null|undefined} error
 * @property {number|undefined} durationSeconds
 * @property {string|undefined} conversationId
 * @property {string|undefined} summary
 * @property {boolean} [killed]
 * @property {string[]} [stderrTail]
 * @property {{tool: string, message: string}[]} [toolErrors]
 */

/**
 * Every warning kind this module can emit, in the order they are printed.
 *
 * Machine-readable list of warning ids in print order, documented in
 * `skills/output-contract/contract.md` and verified by `tests/contract.test.mjs`.
 *
 * @type {readonly string[]}
 */
export const WARNING_IDS = Object.freeze([
  "agy-status",
  "exit",
  "stderr",
  "tool-errors",
  "agy-error",
  "watchdog",
  "resume",
]);

/**
 * Report whether a write-up exists and the git status file delta count
 * to disambiguate non-SUCCESS statuses without judging the run.
 * File count is omitted outside a git repository.
 *
 * @param {ResultView} job
 * @returns {string}
 */
function statusContext(job) {
  const bits = [];
  const hasReport = job.summary != null && String(job.summary).trim() !== '';
  bits.push(hasReport ? 'write-up present' : 'no write-up');
  if (job.gitRepo !== false) {
    const n = job.gitFiles?.length ?? 0;
    bits.push(`${n} file${n === 1 ? '' : 's'} changed`);
  }
  return ` (${bits.join(', ')})`;
}

/**
 * @typedef {Object} Anomaly
 * @property {string} id       one of `WARNING_IDS`
 * @property {string} line     the ⚠ line, without its marker
 * @property {string[]} [detail] indented continuation lines
 */

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

  // When agy produces neither a write-up nor a status event, display stderr
  // to surface initialisation failures (e.g. auth, unknown flags, spawn errors).
  // Runs with a write-up suppress stderr to avoid noisy warnings.
  const saidNothing = (job.summary == null || String(job.summary).trim() === '') && !status;
  const stderrTail = Array.isArray(job.stderrTail) ? job.stderrTail : [];
  if (saidNothing && stderrTail.length > 0) {
    out.push({
      id: 'stderr',
      line: 'agy produced no result. Its stderr:',
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

  if (job.error != null && String(job.error).length > 0) {
    const errLines = String(job.error).split('\n');
    // Error messages can be long; display the first line and truncate details.
    const extras = errLines.slice(1);
    const detail = extras.slice(0, ERROR_TAIL_LIMIT);
    if (extras.length > ERROR_TAIL_LIMIT) {
      detail.push(`… ${extras.length - ERROR_TAIL_LIMIT} more lines (full text in the job log)`);
    }
    out.push({ id: 'agy-error', line: errLines[0], detail });
  }

  if (job.killed) {
    out.push({
      id: 'watchdog',
      line: 'watchdog killed the run — print-timeout plus 60s grace elapsed',
    });
  }

  // Offer resume command when a watchdog-killed run captured a conversation id.
  if (job.killed && job.conversationId) {
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
