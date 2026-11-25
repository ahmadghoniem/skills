// What a run prints: grok's write-up, a ⚠ line for each way the run can be
// wrong while still looking done, and the session id last.

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

/** @param {import('./grok.mjs').RunResult} run */
export function renderResult(run) {
  const warns = warnings(run);
  const lines = [];
  const text = run.text.replace(/\s+$/, '');
  if (text) lines.push(text);
  else if (!warns.length) lines.push('(grok returned no write-up)');
  if (warns.length) {
    if (lines.length) lines.push('');
    for (const w of warns) {
      lines.push(`⚠ ${w.line}`);
      for (const d of w.detail ?? []) lines.push(`    ${d}`);
    }
  }
  lines.push('', `session: ${run.sessionId}`);
  return `${lines.join('\n')}\n`;
}
