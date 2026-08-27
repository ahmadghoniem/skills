// Presentation shared by the foreground dispatch and `/grok:result`, so the
// write-up you see when a job finishes and the one you fetch later cannot drift.
//
// The default output is grok's own write-up and nothing else. What used to sit
// around it — the model id, the finish timestamp, `exit 0`, the cost and turn
// count, and a re-print of the entire prompt you just typed — was either already
// known to whoever dispatched the job or noise on the runs that simply worked.
// The file list went too: it was built from every `file_path` grok's tools
// mentioned, reads included, so a run that read forty files and edited one
// listed forty-one. `git status` is the ground truth and is one call away.
//
// What survives is the set of ways a run can be wrong while still looking done.

/**
 * @typedef {Object} CommandRun
 * @property {string} command
 * @property {number|null} exitCode
 * @property {string} output
 * @property {boolean} timedOut
 */

/**
 * @typedef {Object} OutcomeView
 * @property {string|undefined} summary
 * @property {string|undefined} stopReason
 * @property {number|null|undefined} exitCode
 * @property {boolean} [killed]
 * @property {string} [errorDetail]
 * @property {CommandRun[]} [failedCommands]
 * @property {boolean} [sessionLost]
 * @property {string} [resumableSessionId]
 */

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
  "stop-reason",
  "exit",
  "error-detail",
  "killed",
  "failed-commands",
  "session-lost",
  "resumable",
]);

/**
 * The warning lines for a finished run, in print order. Exported so a test can
 * assert directly that a clean run produces none of them.
 *
 * @param {OutcomeView} view
 * @returns {string[]}
 */
export function warnings(view) {
  const out = [];

  const stop = view.stopReason;
  if (stop && stop !== 'end_turn') {
    out.push(`stop reason: ${stop}`);
  }

  if (typeof view.exitCode === 'number' && view.exitCode !== 0) {
    out.push(`exit ${view.exitCode}`);
  }

  // Why the run stopped, in grok's own words. Two sources feed this: an
  // `error` event when grok emitted one, otherwise the stderr tail on a
  // non-zero exit — the caller picks. Independent of `stop-reason` and `exit`:
  // those two say a run went wrong, this says what went wrong, and a run that
  // dies before emitting anything raises the first two with nothing to explain
  // them.
  const detail = (view.errorDetail ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (detail.length > 0) {
    out.push(`error: ${detail[0]}`);
    for (const line of detail.slice(1, 20)) {
      out.push(`    ${line}`);
    }
  }

  if (view.killed) {
    out.push('run was killed before finishing (timeout or watchdog) — output may be incomplete');
  }

  // Reported, never fatal. A non-zero exit is routinely intentional — `grep`
  // finding nothing, a deliberately red test in a TDD cycle, a `command -v`
  // probe — so the plugin puts the fact in front of a human instead of deciding
  // the run failed. Grok's own `stopReason` remains the only input to status.
  const failed = view.failedCommands ?? [];
  if (failed.length > 0) {
    const n = failed.length;
    out.push(
      `${n} command${n === 1 ? '' : 's'} exited non-zero — reported, not judged; grok may have meant them:`,
    );
    for (const c of failed) {
      out.push(`    ${c.command} → exit ${c.exitCode}${c.timedOut ? ' (timed out)' : ''}`);
      const trimmed = (c.output ?? '').trim();
      for (const line of trimmed ? trimmed.split('\n').slice(0, 10) : []) {
        out.push(`      ${line}`);
      }
    }
  }

  if (view.sessionLost) {
    out.push('no session id was captured — this job cannot be resumed');
  } else if (view.resumableSessionId) {
    // The other half of `session-lost`. That line has always told you when a
    // cut-short run is unrecoverable; nothing told you when it was recoverable,
    // so a resumable session sat on disk and the reflex was to re-send the whole
    // brief. Mutually exclusive with the line above by construction: one says
    // the id is missing, this one carries it.
    out.push(
      `this run ended early — resume it with \`/grok:resume --resume=${view.resumableSessionId}\``,
    );
  }

  return out;
}

/**
 * Grok's write-up, plus a warning line per way the run may have gone wrong.
 * A clean run renders as the write-up alone.
 *
 * @param {OutcomeView} view
 * @returns {string}
 */
export function renderOutcome(view) {
  const report = (view.summary == null ? '' : String(view.summary)).replace(/\s+$/, '');
  const warns = warnings(view);

  const lines = [];
  if (report.length > 0) lines.push(report);
  else if (warns.length === 0) lines.push('(grok returned no write-up)');

  if (warns.length > 0) {
    if (lines.length > 0) lines.push('');
    for (const w of warns) lines.push(w.startsWith('    ') ? w : `⚠ ${w}`);
  }

  return `${lines.join('\n')}\n`;
}
