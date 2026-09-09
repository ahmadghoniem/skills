#!/usr/bin/env node
import { invokedAsScript, parseCommandArgv } from './lib/util/args.mjs';
import { repoRoot } from './lib/util/git.mjs';
import { listJobs, mostRecentFinishedJob, resolveJob } from './lib/jobs.mjs';
import { renderResult } from './lib/render.mjs';

function renderList(jobs) {
  if (jobs.length === 0) return 'No agy jobs tracked for this repository yet.\n';
  const lines = ['id  status  agy  started', ''];
  for (const j of jobs) {
    const agy = j.agyStatus ?? '-';
    lines.push(`${j.id}  ${j.status}  ${agy}  ${j.startedAt}`);
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
  if (flags['list'] || flags['all']) {
    const listOpts = flags['all'] ? {} : { limit: 10 };
    process.stdout.write(renderList(listJobs(root, listOpts)));
    return 0;
  }
  const id = positional[0];
  if (id) {
    const resolved = resolveJob(root, id);
    if (resolved.error) {
      process.stderr.write(`${resolved.error}\n`);
      return 2;
    }
    if (!resolved.job) {
      process.stderr.write(`No job matching '${id}' for this repository.\n`);
      return 1;
    }
    if (resolved.job.status === 'running') {
      process.stdout.write(
        `Job \`${resolved.job.id}\` is still running. Re-run \`/agy:result ${resolved.job.id}\` once it finishes.\n`,
      );
      return 0;
    }
    process.stdout.write(renderResult(resolved.job));
    return 0;
  }
  const job = mostRecentFinishedJob(root);
  if (!job) {
    process.stderr.write('No finished agy jobs tracked for this repository yet.\n');
    return 1;
  }
  process.stdout.write(renderResult(job));
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
