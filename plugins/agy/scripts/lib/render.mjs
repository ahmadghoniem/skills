// Presentation shared by the foreground dispatch and `/agy:result`, so the
// write-up you see when a job finishes and the one you fetch later cannot drift.
//
// The default output is agy's own report and nothing else. Everything the old
// status table printed — status, exit code, duration, conversation id, the
// working-tree listing — was either already visible to the orchestrator (`git
// status` is one call away) or noise on the overwhelming majority of runs that
// simply worked. What survives is the part that is *not* recoverable by looking:
// the four ways a run can be wrong while agy still calls it done.
//
// agy's `status`, the process exit code, and the git working tree remain three
// separate facts (F5). They are never collapsed into a single pass/fail — they
// are each allowed to raise their own line, and any of them may fire alone.

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

const WANDER_WARNING =
  'agy reported file changes but the working tree is unchanged — the writes\n' +
  '  probably landed in ~/.gemini/antigravity-cli/scratch instead of the repo.';

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
 * @property {boolean} [claimedFileChanges]
 * @property {boolean} [killed]
 * @property {string[]} [stderrTail]
 * @property {{tool: string, message: string}[]} [toolErrors]
 */

/**
 * Project a job record onto the view `renderResult` reads.
 *
 * The single mapping. Both callers — the foreground dispatch and `/agy:result`
 * — go through this, because two hand-written copies of the same field list is
 * exactly the drift this module exists to prevent.
 *
 * @param {Record<string, unknown>} job
 * @returns {ResultView}
 */
export function viewFromJob(job) {
  return {
    id: job.id,
    agyStatus: job.agyStatus,
    exitCode: job.exitCode,
    gitRepo: job.gitRepo,
    gitFiles: job.gitFiles,
    error: job.error,
    durationSeconds: job.durationSeconds,
    conversationId: job.conversationId,
    summary: job.summary,
    claimedFileChanges: job.claimedFileChanges,
    killed: job.killed,
    stderrTail: job.stderrTail,
    toolErrors: job.toolErrors,
  };
}

/**
 * Every warning kind this module can emit, in the order they are printed.
 *
 * This is the machine-readable half of `skills/output-contract/contract.md`; that
 * file explains each id in prose. `tests/contract.test.mjs` asserts the two
 * agree in both directions and that neither has grown an entry the other lacks,
 * so a new warning cannot ship undocumented — which is exactly how the contract
 * drifted before this registry existed.
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
  "wander",
]);

/**
 * The two facts that separate an `ERROR` you can ignore from one you cannot.
 *
 * agy reports `ERROR` for a provider stream that blipped in the last second of
 * an otherwise complete run *and* for a run that died having written nothing,
 * and the bare status line reads identically either way. Both facts here are
 * machine-derived — a non-empty write-up, and the count from two
 * `git status --porcelain` snapshots taken either side of the run — so this
 * stays a report, not a verdict: it says what is on disk and leaves the reading
 * of it to a human.
 *
 * The file count is omitted outside a repo, where there is no tree to compare
 * against and `0 files changed` would be a lie rather than a measurement.
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

  // agy said nothing at all: no write-up and no terminal `result` event. That is
  // the shape of "agy never got started" — not authenticated, unknown --model,
  // rejected flag, spawn failure — and every one of them leaves its reason on
  // stderr and nowhere else. Without this the entire class renders as a bare
  // `exit 1`, which does not distinguish between "log in again" (one command),
  // "that model was retired" (re-run /agy:setup), and "rate limited" (wait).
  //
  // Gated hard on BOTH conditions. A run that produced a report keeps its report
  // as the output, however it ended — stderr noise from a working run is exactly
  // what the quiet-by-default contract exists to suppress.
  const saidNothing = (job.summary == null || String(job.summary).trim() === '') && !status;
  const stderrTail = Array.isArray(job.stderrTail) ? job.stderrTail : [];
  if (saidNothing && stderrTail.length > 0) {
    out.push({
      id: 'stderr',
      line: 'agy produced no result. Its stderr:',
      detail: [...stderrTail],
    });
  }

  // Tools that failed while the run continued. agy recovers from most of these
  // and is right to; the case that matters is a failed verification step under a
  // SUCCESS status. Reported, never judged — same stance as grok's failed-command
  // block, which caught exactly this on its first real run. Deduped because a
  // retried tool reports the same failure every attempt.
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
    // agy's errors can carry a long tail. An unknown `--model` appends the whole
    // catalogue — sixteen lines of menu behind one line of fact. The first line
    // names the problem; keep a little context and say how much was dropped.
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

  // A killed run is the one case where the work really is half-finished, and
  // agy's conversation survives it: `conversation_id` arrives on the `init`
  // event, long before the kill, so it is already on the record. Without this
  // line the id is on disk and nothing says so, and the reflex is to re-dispatch
  // the whole brief. Fires only alongside the watchdog line — a run that
  // finished has nothing to resume.
  if (job.killed && job.conversationId) {
    out.push({
      id: 'resume',
      line: `this run can be resumed where it stopped: /agy:resume ${job.id}`,
    });
  }

  // Only meaningful inside a repo: outside one there is no tree to compare
  // against, so silence is the honest answer rather than a false alarm.
  const noGitChanges = job.gitRepo !== false && (job.gitFiles?.length ?? 0) === 0;
  if (noGitChanges && job.claimedFileChanges) {
    out.push({ id: 'wander', line: WANDER_WARNING });
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

export { WANDER_WARNING };
