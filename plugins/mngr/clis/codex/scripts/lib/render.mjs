// codex's ⚠ lines: each way a run can be wrong while still looking done. The
// shared delegate run prints them under the write-up.

/** Every ⚠ id, in print order. `contract.md` explains each; a test keeps them in step. */
export const WARNING_IDS = Object.freeze(['exit', 'error-detail']);

export function warnings(run) {
  const out = [];
  if (run.exitCode !== 0) out.push({ id: 'exit', line: `exit ${run.exitCode}` });
  const lines = String(run.error ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length) out.push({ id: 'error-detail', line: `error: ${lines[0]}`, detail: lines.slice(1, 20) });
  return out;
}

export const isUnfinished = (run) => run.exitCode !== 0 || Boolean(run.error);
