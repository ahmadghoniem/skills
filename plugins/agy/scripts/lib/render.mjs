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
 */

/**
 * The anomaly lines for a finished job, in the order they are printed. Exported
 * so a test can assert "a clean run produces none of these" directly.
 *
 * @param {ResultView} job
 * @returns {string[]}
 */
export function anomalies(job) {
  const out = [];

  const status = job.agyStatus == null ? '' : String(job.agyStatus);
  if (status && status.toUpperCase() !== 'SUCCESS') {
    out.push(`agy status: ${status}`);
  }

  if (typeof job.exitCode === 'number' && job.exitCode !== 0) {
    out.push(`exit ${job.exitCode}`);
  }

  if (job.error != null && String(job.error).length > 0) {
    const errLines = String(job.error).split('\n');
    out.push(errLines[0]);
    for (const extra of errLines.slice(1)) out.push(`  ${extra}`);
  }

  if (job.killed) {
    out.push('watchdog killed the run — print-timeout plus 60s grace elapsed');
  }

  // Only meaningful inside a repo: outside one there is no tree to compare
  // against, so silence is the honest answer rather than a false alarm.
  const noGitChanges = job.gitRepo !== false && (job.gitFiles?.length ?? 0) === 0;
  if (noGitChanges && job.claimedFileChanges) {
    out.push(WANDER_WARNING);
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
    for (const w of warnings) lines.push(`⚠ ${w}`);
  }

  return `${lines.join('\n')}\n`;
}

export { WANDER_WARNING };
