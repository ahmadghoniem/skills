// What a run prints: agy's report, a ⚠ line for each way the run can be wrong
// while still looking done, and the conversation id last. Status and exit code
// are separate facts that can each raise a line; nothing is folded into a verdict.

/** Continuation lines of agy's `error` kept before truncation. */
const ERROR_TAIL_LIMIT = 4;

/** Every ⚠ id, in print order. `contract.md` at the plugin root explains each; a test keeps them in step. */
export const WARNING_IDS = Object.freeze(['agy-status', 'exit', 'stderr', 'agy-error', 'finished-reason']);

/**
 * @typedef {Object} RunView
 * @property {string|null} [agyStatus]
 * @property {number} exitCode
 * @property {string|null} [error]
 * @property {string} [response]
 * @property {string} [conversationId]
 * @property {string} [finishedReason]
 * @property {string[]} [stderr]
 * @property {string[]} [validModels]  agy's model ids, listed when it rejected the model
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
    const hasReport = Boolean(String(run.response ?? '').trim());
    out.push({ id: 'agy-status', line: `agy status: ${status} (${hasReport ? 'write-up present' : 'no write-up'})` });
  }
  if (run.exitCode !== 0) out.push({ id: 'exit', line: `exit ${run.exitCode}` });

  // On a run that worked, stderr holds background notes; on one that did not, it
  // is often the only record of why (not signed in, a rejected flag, AGY_ERROR).
  const stderr = run.stderr ?? [];
  if (stderr.length && isUnfinished(run)) out.push({ id: 'stderr', line: 'agy wrote to stderr:', detail: [...stderr] });

  if (run.error) {
    const lines = String(run.error).split('\n');
    let detail = lines.slice(1, 1 + ERROR_TAIL_LIMIT);
    if (lines.length - 1 > ERROR_TAIL_LIMIT) detail.push(`… ${lines.length - 1 - ERROR_TAIL_LIMIT} more lines`);
    // agy names display labels, which `--model` does not accept; list the ids.
    if (run.validModels?.length) detail = ['Valid ids:', ...run.validModels.map((id) => `  ${id}`)];
    out.push({ id: 'agy-error', line: lines[0], detail });
  }

  // agy's own reason for ending the turn early, verbatim: `print_timeout`,
  // `interrupted`, `error`, or one a later agy adds.
  if (run.finishedReason) out.push({ id: 'finished-reason', line: `agy ended the turn early: finished_reason ${run.finishedReason}` });
  return out;
}

/** @param {RunView} run */
export function renderResult(run) {
  const warns = anomalies(run);
  const lines = [];
  const report = String(run.response ?? '').replace(/\s+$/, '');
  if (report) lines.push(report);
  else if (!warns.length) lines.push('(agy returned no report)');
  if (warns.length) {
    if (lines.length) lines.push('');
    for (const w of warns) {
      lines.push(`⚠ ${w.line}`);
      for (const d of w.detail ?? []) lines.push(`  ${d}`);
    }
  }
  if (run.conversationId) lines.push('', `conversation: ${run.conversationId}`);
  return `${lines.join('\n')}\n`;
}
