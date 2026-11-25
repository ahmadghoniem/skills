// What a run prints: opencode's write-up, a ⚠ line for each way the run can be
// wrong while still looking done, and the session id last.

/** Every ⚠ id, in print order. `contract.md` at the plugin root explains each; a test keeps them in step. */
export const WARNING_IDS = Object.freeze(['exit', 'error-detail']);

export function warnings(run) {
  const out = [];
  if (run.exitCode !== 0) out.push({ id: 'exit', line: `exit ${run.exitCode}` });
  const lines = String(run.error ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length) out.push({ id: 'error-detail', line: `error: ${lines[0]}`, detail: lines.slice(1, 20) });
  return out;
}

export const isUnfinished = (run) => run.exitCode !== 0 || Boolean(run.error);

export function renderResult(run) {
  const warns = warnings(run);
  const lines = [];
  const text = String(run.text ?? '').replace(/\s+$/, '');
  if (text) lines.push(text);
  else if (!warns.length) lines.push('(opencode returned no write-up)');
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
