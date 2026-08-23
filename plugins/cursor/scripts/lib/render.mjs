// Presentation shared by the foreground dispatch and `/cursor:result`, so the
// write-up you see when a job finishes and the one you fetch later cannot drift.

/**
 * Files touched, plus the failed-command report.
 *
 * The failed-command section is reported, never fatal. A non-zero exit is
 * routinely intentional — `grep` finding nothing, a deliberately red test in a
 * TDD cycle, a `command -v` probe — so the plugin puts the fact in front of a
 * human instead of deciding the run failed. cursor-agent's own result event
 * remains the only input to job status.
 *
 * @param {{filesTouched: string[], failedCommands: Array<{command: string, exitCode: number|null, output: string, timedOut: boolean}>}} summary
 * @returns {string}
 */
export function renderRunDetail(summary) {
  const files = summary.filesTouched ?? [];
  const failed = summary.failedCommands ?? [];
  const out = [];
  if (files.length > 0) {
    out.push('**Files touched:**');
    for (const f of files) out.push(`- ${f}`);
    out.push('');
  }
  if (failed.length > 0) {
    out.push(`**⚠ Commands that exited non-zero (${failed.length}):**`);
    out.push('');
    for (const c of failed) {
      out.push(`- \`${c.command}\` → exit ${c.exitCode}${c.timedOut ? ' (timed out)' : ''}`);
      const trimmed = (c.output ?? '').trim();
      if (trimmed) {
        out.push('  ```');
        for (const line of trimmed.split('\n').slice(0, 10)) out.push(`  ${line}`);
        out.push('  ```');
      }
    }
    out.push('');
    out.push(
      'These are reported, not judged — cursor-agent may have meant them (a `grep` miss, a red test). Check them before trusting the summary.',
    );
    out.push('');
  }
  // A trailing blank line, so whatever the caller prints next (the summary
  // heading) is separated rather than butted against the last bullet.
  return out.length > 0 ? `${out.join('\n')}\n` : '';
}
