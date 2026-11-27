// grok's ⚠ lines: each way a run can be wrong while still looking done. The
// shared delegate run prints them under the write-up.

/** Every ⚠ id, in print order. `contract.md` explains each; a test keeps them in step. */
export const WARNING_IDS = Object.freeze(['stop-reason', 'exit', 'error-detail']);

/**
 * @param {import('./grok.mjs').RunResult} run
 * @returns {{id: string, line: string, detail?: string[]}[]}
 */
export function warnings(run) {
  const out = [];
  if (run.stopReason && run.stopReason !== 'end_turn') out.push({ id: 'stop-reason', line: `stop reason: ${run.stopReason}` });
  if (run.exitCode !== 0) out.push({ id: 'exit', line: `exit ${run.exitCode}` });
  const lines = String(run.error ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length) out.push({ id: 'error-detail', line: `error: ${lines[0]}`, detail: lines.slice(1, 20) });
  return out;
}

/** Whether the run stopped before grok finished; `delegate.mjs` exits 1 on these. */
export function isUnfinished(run) {
  return run.exitCode !== 0 || Boolean(run.error) || (Boolean(run.stopReason) && run.stopReason !== 'end_turn');
}

