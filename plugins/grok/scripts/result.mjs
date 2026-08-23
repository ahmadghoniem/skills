#!/usr/bin/env node
import { parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { jobNotFoundMessage } from './lib/hints.mjs';
import { listJobs, mostRecentFinishedJob, readJob } from './lib/jobs.mjs';
import { renderJobTable } from './lib/jobtable.mjs';
import { costLine, renderRunDetail } from './lib/render.mjs';

function render(job) {
  const summary = typeof job.summary === 'string' ? job.summary : '';
  const lines = [];
  lines.push(`### Result of job \`${job.id}\` — ${job.status}`);
  lines.push('');
  lines.push(`**Model:** ${String(job.model ?? '?')}`);
  if (job.finishedAt) lines.push(`**Finished:** ${job.finishedAt}`);
  if (typeof job.exitCode === 'number') lines.push(`**Exit code:** ${job.exitCode}`);
  if (job.stopReason && job.stopReason !== 'end_turn') {
    lines.push(`**Stop reason:** ${job.stopReason}`);
  }
  const cost = costLine(job);
  if (cost) lines.push(cost.trimEnd());
  lines.push('');
  lines.push(`**Prompt:** ${String(job.prompt ?? '')}`);
  lines.push('');
  const detail = renderRunDetail(job);
  if (detail) lines.push(detail);
  lines.push('**Summary:**');
  lines.push('');
  lines.push((summary || '(no summary captured)').trim());
  lines.push('');
  if (job.grokSessionId) {
    lines.push(
      `Continue this session: \`/grok:delegate --resume=${job.grokSessionId} <follow-up>\``,
    );
  } else {
    lines.push('No grok session id was captured for this job.');
  }
  return lines.join('\n') + '\n';
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { positional, flags } = parseCommandArgv(rawArgv, ['list', 'all']);
  const root = await repoRoot(process.cwd());
  if (flags['list']) {
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
