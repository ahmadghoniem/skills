#!/usr/bin/env node
import { parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { jobNotFoundMessage } from './lib/hints.mjs';
import { listJobs, mostRecentFinishedJob, readJob } from './lib/jobs.mjs';
import { renderJobTable } from './lib/jobtable.mjs';
import { renderOutcome } from './lib/render.mjs';

// A finished job carries no `killed` flag of its own: the worker records a kill
// by appending a post-flight note to the summary and by landing the job at
// status `failed`, which already raises its own warning here.
function render(job) {
  return renderOutcome({
    summary: job.summary,
    // `cliSuccess` is cursor-agent's own verdict, recorded by the worker.
    // Older job records predate it; fall back to plugin status for those.
    success: typeof job.cliSuccess === 'boolean' ? job.cliSuccess : job.status !== 'failed',
    exitCode: job.exitCode,
    failedCommands: job.failedCommands,
    chatLost: job.status === 'failed' && !job.cursorChatId,
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
    // Listing every tracked job, running ones included — this is the recovery
    // path for "which job was that?", so a running job must still show up.
    const listOpts = flags['all'] ? {} : { limit: 10 };
    process.stdout.write(renderJobTable(listJobs(root, listOpts)));
    return 0;
  }
  const id = positional[0];
  const job = id ? readJob(root, id) : mostRecentFinishedJob(root);
  if (!job) {
    process.stderr.write(
      id ? jobNotFoundMessage(id) : 'No finished Cursor jobs tracked for this repository yet.\n',
    );
    return 1;
  }
  if (job.status === 'running') {
    process.stdout.write(
      `Job \`${job.id}\` is still running. Re-run \`/cursor:result ${job.id}\` once it finishes.\n`,
    );
    return 0;
  }
  process.stdout.write(render(job));
  return 0;
}

import { invokedAsScript as __isScript } from './lib/invoked.mjs';
const invokedAsScript = __isScript(import.meta.url);

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`result failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
