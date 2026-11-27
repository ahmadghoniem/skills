// agy's ⚠ lines: each way a run can be wrong while still looking done. The
// shared delegate run prints them under the report. Status and exit code are
// separate facts that can each raise a line; nothing is folded into a verdict.

/** Continuation lines of agy's `error` kept before truncation. */
const ERROR_TAIL_LIMIT = 4;

/** Every ⚠ id, in print order. `contract.md` at the plugin root explains each; a test keeps them in step. */
export const WARNING_IDS = Object.freeze(['agy-status', 'exit', 'stderr', 'agy-error', 'finished-reason']);

/**
 * @typedef {Object} RunView
 * @property {string|null} [agyStatus]
 * @property {number} exitCode
 * @property {string|null} [error]
 * @property {string} [text]
 * @property {string} [sessionId]  the conversation id
 * @property {string} [finishedReason]
 * @property {string[]} [stderr]
 */

/**
 * Whether the run ended before agy finished; `delegate.mjs` exits 1 on these.
 * agy exits 3 when a turn ends on a model or agent API error, even after a partial reply.
 */
export function isUnfinished(run) {
  return run.exitCode !== 0 || Boolean(run.finishedReason) || String(run.agyStatus ?? '').toUpperCase() === 'ERROR';
}

/**
 * @param {RunView} run
 * @returns {{id: string, line: string, detail?: string[]}[]}
 */
export function anomalies(run) {
  const out = [];
  const status = run.agyStatus == null ? '' : String(run.agyStatus);
  if (status && status.toUpperCase() !== 'SUCCESS') {
    const hasReport = Boolean(String(run.text ?? '').trim());
    out.push({ id: 'agy-status', line: `agy status: ${status} (${hasReport ? 'write-up present' : 'no write-up'})` });
  }
  if (run.exitCode !== 0) out.push({ id: 'exit', line: `exit ${run.exitCode}` });

  // On a run that worked, stderr holds background notes; on one that did not, it
  // is often the only record of why (not signed in, a rejected flag, AGY_ERROR).
  const stderr = run.stderr ?? [];
  if (stderr.length && isUnfinished(run)) out.push({ id: 'stderr', line: 'agy wrote to stderr:', detail: [...stderr] });

  if (run.error) {
    const lines = String(run.error).split('\n');
    const detail = lines.slice(1, 1 + ERROR_TAIL_LIMIT);
    if (lines.length - 1 > ERROR_TAIL_LIMIT) detail.push(`… ${lines.length - 1 - ERROR_TAIL_LIMIT} more lines`);
    out.push({ id: 'agy-error', line: lines[0], detail });
  }

  // agy's own reason for ending the turn early, verbatim: `print_timeout`,
  // `interrupted`, `error`, or one a later agy adds.
  if (run.finishedReason) out.push({ id: 'finished-reason', line: `agy ended the turn early: finished_reason ${run.finishedReason}` });
  return out;
}

