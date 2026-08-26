#!/usr/bin/env node
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { jobNotFoundMessage } from './lib/hints.mjs';
import { listJobs, mostRecentFinishedJob, readJob } from './lib/jobs.mjs';
import { renderJobTable } from './lib/jobtable.mjs';
import { renderOutcome } from './lib/render.mjs';

// A finished job carries no `killed` flag of its own; the worker records the
// kill by appending a post-flight note to the summary and by landing the job at
// status `failed` with a truncated stream (`stopReason` never reaches
// `end_turn`). Those two already raise their own warnings, so nothing is lost by
// not re-deriving it here.
function render(job) {
  return renderOutcome({
    summary: job.summary,
    stopReason: job.stopReason,
    exitCode: job.exitCode,
    failedCommands: job.failedCommands,
    sessionLost: job.status === 'failed' && !job.grokSessionId,
    resumableSessionId:
      job.status === 'failed' && job.grokSessionId ? job.grokSessionId : undefined,
  });
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { positional, flags } = parseCommandArgv(rawArgv, ['list', 'all']);
  const root = await repoRoot(process.cwd());
  // `--all` implies `--list`. It has no other meaning, and without this a bare
  // `--all` silently fell through to "print the most recent job" — the same
  // shape of output, different content, with nothing to signal the flag was
  // ignored. Worse than an error.
  if (flags['list'] || flags['all']) {
    // Running jobs included on purpose — this is the recovery path for "which
    // job was that?", which is exactly when a job has not finished yet.
    const listOpts = flags['all'] ? {} : { limit: 10 };
    process.stdout.write(renderJobTable(listJobs(root, listOpts)));
    return 0;
  }
  const id = positional[0];
  const job = id ? readJob(root, id) : mostRecentFinishedJob(root);
  if (!job) {
    process.stderr.write(
      id ? jobNotFoundMessage(id) : 'No finished Grok jobs tracked for this repository yet.\n',
    );
    return 1;
  }
  if (job.status === 'running') {
    process.stdout.write(
      `Job \`${job.id}\` is still running. Re-run \`/grok:result ${job.id}\` once it finishes.\n`,
    );
    return 0;
  }
  process.stdout.write(render(job));
  return 0;
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`result failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
