// Presentation shared by the foreground dispatch and `/opencode:result`, so
// the write-up you see when a job finishes and the one you fetch later cannot
// drift.
//
// Default output is opencode's own report. The finish reason and the exit code
// are separate facts that can raise individual warning lines rather than being
// collapsed into a single pass/fail verdict.

/** Beyond this many distinct tool failures the list stops being readable. */
const TOOL_ERROR_LIMIT = 3;

/** How many continuation lines of an error survive before truncation. */
const ERROR_TAIL_LIMIT = 4;

/**
 * Tool failures are frequently multi-line. The first line carries the fact;
 * the rest is restatement.
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
 * @property {string=} status
 * @property {string|null=} finishReason
 * @property {number|null=} exitCode
 * @property {string|null=} error
 * @property {number=} durationSeconds
 * @property {string=} sessionId
 * @property {string=} summary
 * @property {string=} model
 * @property {number=} costUsd
 * @property {{input?: number, output?: number, reasoning?: number, cacheRead?: number, cacheWrite?: number}=} tokens
 * @property {number=} steps
 * @property {number=} toolCalls
 * @property {boolean=} killed
 * @property {string[]=} stderrTail
 * @property {{tool: string, message: string}[]=} toolErrors
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
  'finish-reason',
  'exit',
  'stderr',
  'tool-errors',
  'opencode-error',
  'no-finish',
  'watchdog',
  'no-session',
  'resume',
]);

/**
 * What a non-`stop` finish reason means, in the terms the reader needs.
 * Unknown reasons are reported verbatim rather than guessed at.
 *
 * @param {string} reason
 * @returns {string|null}
 */
function finishReasonDetail(reason) {
  switch (reason) {
    case 'tool-calls':
      return 'the run ended on a tool call rather than a closing message — opencode stopped mid-task, so the work is likely partial';
    case 'length':
      return "the model hit its output limit; whatever it was in the middle of is cut off";
    case 'aborted':
      return 'the session was aborted';
    case 'error':
      return 'the model provider returned an error for the final step';
    default:
      return null;
  }
}

/**
 * Report whether a write-up exists, to disambiguate an odd finish reason
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
 * @property {string[]=} detail indented continuation lines
 */

/**
 * Whether the run ended before opencode finished: the plugin's own record says
 * so (`failed`, `cancelled`, `orphaned`), the watchdog killed it, or the last
 * step closed on something other than `stop`.
 *
 * One definition shared by the resume offer, the exit code, and the watchdog
 * line.
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
    (job.finishReason != null && job.finishReason !== 'stop') ||
    neverFinished(job)
  );
}

/**
 * A run that opened a session and then never completed a single step: no
 * `step_finish` ever arrived, so there is no finish reason to judge.
 *
 * This is what a provider error looks like from the outside — opencode opens
 * the session, the first request comes back 4xx, and the process exits having
 * emitted one `error` event and nothing else. Without this, such a run has
 * `finishReason: null`, fails every other unfinished test, and is reported to
 * the caller as a success with exit 0. The plugin's one job is not to lie
 * about a run, so a run that did nothing has to say so.
 *
 * @param {ResultView} job
 * @returns {boolean}
 */
function neverFinished(job) {
  if (job.status === 'running') return false;
  return Boolean(job.sessionId) && job.finishReason == null;
}

/**
 * The anomalies for a finished job, in the order they are printed.
 *
 * @param {ResultView} job
 * @returns {Anomaly[]}
 */
export function anomalies(job) {
  /** @type {Anomaly[]} */
  const out = [];

  const reason = job.finishReason == null ? '' : String(job.finishReason);
  if (reason && reason !== 'stop') {
    const detail = finishReasonDetail(reason);
    out.push({
      id: 'finish-reason',
      line: `opencode stopped with reason: ${reason}${statusContext(job)}`,
      detail: detail ? [detail] : undefined,
    });
  }

  if (typeof job.exitCode === 'number' && job.exitCode !== 0) {
    out.push({ id: 'exit', line: `exit ${job.exitCode}` });
  }

  // opencode is quiet on stderr when nothing went wrong, so anything there is
  // worth showing: auth failures, an unknown model, provider errors.
  const stderrTail = Array.isArray(job.stderrTail) ? job.stderrTail : [];
  if (stderrTail.length > 0) {
    out.push({
      id: 'stderr',
      line: 'opencode wrote to stderr:',
      detail: [...stderrTail],
    });
  }

  // Tools opencode could not run at all, deduped across repeated attempts.
  // A shell command that ran and exited non-zero is NOT here — opencode marks
  // that tool `completed` and puts the failure in its output. See contract.md.
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
      line: `${unique.length} ${noun} failed to run — reported, not judged:`,
      detail,
    });
  }

  if (job.error != null && String(job.error).length > 0) {
    const errLines = String(job.error).split('\n');
    const extras = errLines.slice(1);
    const detail = extras.slice(0, ERROR_TAIL_LIMIT);
    if (extras.length > ERROR_TAIL_LIMIT) {
      detail.push(`… ${extras.length - ERROR_TAIL_LIMIT} more lines (full text in the job log)`);
    }
    out.push({ id: 'opencode-error', line: errLines[0], detail });
  }

  if (neverFinished(job)) {
    out.push({
      id: 'no-finish',
      line: 'opencode opened a session but never completed a step — no work was done',
      detail: ['the run ended before the model produced anything; read the error line above for why'],
    });
  }

  if (job.killed) {
    out.push({
      id: 'watchdog',
      line: 'watchdog killed the run — the timeout elapsed with opencode still working',
    });
  }

  // No session id means opencode never got as far as opening one: a bad flag,
  // an unknown model, or an unauthenticated provider. Nothing can be resumed.
  if (!job.sessionId && job.status !== 'running') {
    out.push({
      id: 'no-session',
      line: 'opencode opened no session — it exited before starting work, so nothing was done and there is nothing to resume',
    });
  }

  if (isUnfinished(job) && job.sessionId) {
    out.push({
      id: 'resume',
      line: `this run can be resumed where it stopped: /opencode:resume ${job.id}`,
    });
  }

  return out;
}

/**
 * Round a dollar amount to something readable without pretending to more
 * precision than a sub-cent run has.
 *
 * @param {number} usd
 * @returns {string}
 */
function formatCost(usd) {
  if (!Number.isFinite(usd) || usd <= 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * The one-line run stats footer. opencode reports real token counts and a real
 * dollar cost per step, which agy and cursor cannot, so they are shown rather
 * than thrown away. This is a record of what the run consumed, not a verdict
 * on it.
 *
 * @param {ResultView} job
 * @returns {string|null}
 */
export function renderStats(job) {
  /** @type {string[]} */
  const parts = [];
  if (job.model) parts.push(String(job.model));
  if (typeof job.costUsd === 'number' && job.costUsd > 0) parts.push(formatCost(job.costUsd));
  const t = job.tokens;
  if (t && (t.input || t.output)) {
    const io = `${t.input ?? 0} in / ${t.output ?? 0} out`;
    const cached = t.cacheRead ? `, ${t.cacheRead} cached` : '';
    parts.push(`${io}${cached}`);
  }
  if (typeof job.toolCalls === 'number' && job.toolCalls > 0) {
    parts.push(`${job.toolCalls} tool call${job.toolCalls === 1 ? '' : 's'}`);
  }
  if (typeof job.durationSeconds === 'number' && job.durationSeconds > 0) {
    parts.push(`${job.durationSeconds}s`);
  }
  return parts.length > 0 ? parts.join('  ·  ') : null;
}

/**
 * opencode's report, a warning line per way the run may have gone wrong, and
 * the run's cost. A clean run renders as the report plus one stats line.
 *
 * @param {ResultView} job
 * @returns {string}
 */
export function renderResult(job) {
  const report = (job.summary == null ? '' : String(job.summary)).replace(/\s+$/, '');
  const warnings = anomalies(job);

  const lines = [];
  if (report.length > 0) lines.push(report);
  else if (warnings.length === 0) lines.push('(opencode returned no report)');

  if (warnings.length > 0) {
    if (lines.length > 0) lines.push('');
    for (const w of warnings) {
      lines.push(`⚠ ${w.line}`);
      for (const d of w.detail ?? []) lines.push(`  ${d}`);
    }
  }

  const stats = renderStats(job);
  if (stats) {
    lines.push('');
    lines.push(stats);
  }

  return `${lines.join('\n')}\n`;
}
