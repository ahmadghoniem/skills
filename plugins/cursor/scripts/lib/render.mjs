// Presentation shared by the foreground dispatch and `/cursor:result`, so the
// write-up you see when a job finishes and the one you fetch later cannot drift.
//
// The default output is cursor-agent's own write-up and nothing else. What used
// to sit around it — the model id, the finish timestamp, `exit 0`, and a
// re-print of the entire prompt you just typed — was either already known to
// whoever dispatched the job or noise on the runs that simply worked. The file
// list went too: it was built from every path cursor-agent's tools mentioned,
// reads included, so a run that read forty files and edited one listed
// forty-one. `git status` is the ground truth and is one call away.
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
 * @property {boolean} [success]        cursor-agent's own result event.
 * @property {string} [exitReason]
 * @property {number|null|undefined} exitCode
 * @property {boolean} [killed]
 * @property {CommandRun[]} [failedCommands]
 * @property {string} [ranAs]         Concrete model id, when it differs from the
 *                                    one the dispatch banner announced.
 * @property {boolean} [chatLost]
 */

/**
 * The warning lines for a finished run, in print order. Exported so a test can
 * assert directly that a clean run produces none of them.
 *
 * @param {OutcomeView} view
 * @returns {string[]}
 */
export function warnings(view) {
  const out = [];

  // Only surfaced when it is a surprise. Pin a model and get it, and the banner
  // already said so; ask for `auto` and this is the only place the concrete id
  // the run actually used ever appears.
  if (view.ranAs) {
    out.push(`ran as ${view.ranAs}, not the model the dispatch line named`);
  }

  // cursor-agent's own verdict and the process exit code are separate facts and
  // are each allowed to fire alone — they disagree in both directions.
  if (view.success === false) {
    const why = view.exitReason ? ` (${view.exitReason})` : '';
    out.push(`cursor-agent did not report success${why}`);
  }

  if (typeof view.exitCode === 'number' && view.exitCode !== 0) {
    out.push(`exit ${view.exitCode}`);
  }

  if (view.killed) {
    out.push('run was killed before finishing (timeout or watchdog) — output may be incomplete');
  }

  // Reported, never fatal. A non-zero exit is routinely intentional — `grep`
  // finding nothing, a deliberately red test in a TDD cycle, a `command -v`
  // probe — so the plugin puts the fact in front of a human instead of deciding
  // the run failed.
  const failed = view.failedCommands ?? [];
  if (failed.length > 0) {
    const n = failed.length;
    out.push(
      `${n} command${n === 1 ? '' : 's'} exited non-zero — reported, not judged; cursor-agent may have meant them:`,
    );
    for (const c of failed) {
      out.push(`    ${c.command} → exit ${c.exitCode}${c.timedOut ? ' (timed out)' : ''}`);
      const trimmed = (c.output ?? '').trim();
      for (const line of trimmed ? trimmed.split('\n').slice(0, 10) : []) {
        out.push(`      ${line}`);
      }
    }
  }

  if (view.chatLost) {
    out.push('no cursor chat id was captured — this job cannot be resumed');
  }

  return out;
}

/**
 * cursor-agent's write-up, plus a warning line per way the run may have gone
 * wrong. A clean run renders as the write-up alone.
 *
 * @param {OutcomeView} view
 * @returns {string}
 */
export function renderOutcome(view) {
  const report = (view.summary == null ? '' : String(view.summary)).replace(/\s+$/, '');
  const warns = warnings(view);

  const lines = [];
  if (report.length > 0) lines.push(report);
  else if (warns.length === 0) lines.push('(cursor-agent returned no write-up)');

  if (warns.length > 0) {
    if (lines.length > 0) lines.push('');
    for (const w of warns) lines.push(w.startsWith('    ') ? w : `⚠ ${w}`);
  }

  return `${lines.join('\n')}\n`;
}
