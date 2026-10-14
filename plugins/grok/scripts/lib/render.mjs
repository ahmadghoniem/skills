// Presentation shared by `/grok:delegate` and `/grok:result`: both render the
// finished job record, so the output at dispatch and the one fetched later
// cannot drift.
//
// The default output is grok's own write-up and nothing else. `git status` is
// the record of what changed, so no file list, timing or token count is added.
// What is added is a ⚠ line for each way a run can be wrong while still
// looking done.

/**
 * Every warning kind this module can emit, in the order they are printed.
 *
 * The machine-readable half of `contract.md` at the plugin root, which explains
 * each id in prose. `tests/contract.test.mjs` fails if the two disagree.
 *
 * @type {readonly string[]}
 */
export const WARNING_IDS = Object.freeze([
  'stop-reason',
  'exit',
  'error-detail',
  'killed',
  'failed-commands',
  'resume',
  'wander',
]);

export const WANDER_WARNING =
  'grok reported file changes but the working tree is unchanged — the writes\n' +
  '  did not land where you are looking.';

/**
 * @typedef {import('./jobs.mjs').JobRecord} JobRecord
 */

/**
 * @typedef {Object} Warning
 * @property {string} id       one of `WARNING_IDS`
 * @property {string} line     the ⚠ line, without its marker
 * @property {string[]} [detail] indented continuation lines
 */

/**
 * Whether the run stopped before grok finished it. `delegate.mjs` exits 1 on
 * these, and they are the runs `/grok:resume` can pick up.
 *
 * @param {Partial<JobRecord>} job
 * @returns {boolean}
 */
export function isUnfinished(job) {
  return (
    job.status === 'failed' ||
    job.status === 'cancelled' ||
    job.status === 'orphaned' ||
    Boolean(job.killed)
  );
}

/**
 * The warnings for a finished job, in print order. The papercut log records
 * the same list, so the log and the ⚠ lines cannot drift apart.
 *
 * @param {Partial<JobRecord>} job
 * @returns {Warning[]}
 */
export function warnings(job) {
  /** @type {Warning[]} */
  const out = [];

  const stop = job.stopReason;
  if (stop && stop !== 'end_turn') {
    out.push({ id: 'stop-reason', line: `stop reason: ${stop}` });
  }

  if (typeof job.exitCode === 'number' && job.exitCode !== 0) {
    out.push({ id: 'exit', line: `exit ${job.exitCode}` });
  }

  // Why the run stopped, in grok's words: its `error` event, or the stderr
  // tail on a failing exit. The two lines above say a run went wrong; this
  // says what went wrong.
  const detail = String(job.errorDetail ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (detail.length > 0) {
    out.push({ id: 'error-detail', line: `error: ${detail[0]}`, detail: detail.slice(1, 20) });
  }

  if (job.killed) {
    out.push({
      id: 'killed',
      line: 'run was killed before finishing (timeout or watchdog) — output may be incomplete',
    });
  }

  // Reported, never fatal. A non-zero exit is often intended: `grep` finding
  // nothing, a red test in a TDD cycle, a `command -v` probe.
  const failed = job.failedCommands ?? [];
  if (failed.length > 0) {
    const n = failed.length;
    const detailLines = [];
    for (const c of failed) {
      detailLines.push(`${c.command} → exit ${c.exitCode}${c.timedOut ? ' (timed out)' : ''}`);
      const trimmed = (c.output ?? '').trim();
      for (const line of trimmed ? trimmed.split('\n').slice(0, 10) : []) {
        detailLines.push(`  ${line}`);
      }
    }
    out.push({
      id: 'failed-commands',
      line: `${n} command${n === 1 ? '' : 's'} exited non-zero — reported, not judged; grok may have meant them:`,
      detail: detailLines,
    });
  }

  // `grokSessionId` is recorded on grok's first event, so a run refused before
  // the session started (not signed in, a rejected flag) offers nothing.
  if (isUnfinished(job) && job.grokSessionId && job.id) {
    out.push({
      id: 'resume',
      line: `this run can be resumed where it stopped: /grok:resume ${job.id}`,
    });
  }

  // The write-up says files were written and two `git status` readings, taken
  // either side of the run, disagree. Outside a git repo there is nothing to
  // compare against, so it is not checked.
  const noGitChanges = job.gitRepo !== false && (job.gitFiles?.length ?? 0) === 0;
  if (noGitChanges && job.claimedFileChanges) {
    out.push({ id: 'wander', line: WANDER_WARNING });
  }

  return out;
}

/**
 * Grok's write-up, plus a warning line per way the run may have gone wrong.
 * A clean run renders as the write-up alone.
 *
 * @param {Partial<JobRecord>} job
 * @returns {string}
 */
export function renderResult(job) {
  const report = (job.summary == null ? '' : String(job.summary)).replace(/\s+$/, '');
  const warns = warnings(job);

  const lines = [];
  if (report.length > 0) lines.push(report);
  else if (warns.length === 0) lines.push('(grok returned no write-up)');

  if (warns.length > 0) {
    if (lines.length > 0) lines.push('');
    for (const w of warns) {
      lines.push(`⚠ ${w.line}`);
      for (const d of w.detail ?? []) lines.push(`    ${d}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
