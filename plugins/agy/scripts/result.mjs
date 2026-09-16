#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { listJobs, mostRecentFinishedJob, resolveJob } from './lib/jobs.mjs';
import { parseEvents, summariseEvents } from './lib/parse.mjs';
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
 * @param {number} ms
 * @returns {string}
 */
function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${s}s`;
}

/**
 * A running job has no `result` event yet, so `renderResult` cannot be used.
 * Read what has streamed in so far and print one progress line instead of
 * "still running" alone. Safe on a missing or empty log, or one torn by a
 * write still in progress: `parseEvents`/`parseLine` drop what they cannot
 * parse.
 *
 * @param {import('./lib/jobs.mjs').JobRecord} job
 * @returns {string}
 */
function renderRunning(job) {
  let text = '';
  try {
    text = readFileSync(job.rawLogPath, 'utf8');
  } catch {
    // No log written yet.
  }
  const summary = summariseEvents(parseEvents(text));
  const elapsed = formatElapsed(Date.now() - Date.parse(job.startedAt));
  const toolCalls = summary.toolCalls;
  const lastTool = summary.lastTool ? `, last tool ${summary.lastTool}` : '';
  const failures = summary.toolErrors.length;
  const failureNote =
    failures > 0
      ? `, ${failures} tool failure${failures === 1 ? '' : 's'} so far (agy may retry)`
      : '';
  return (
    `Job \`${job.id}\` is still running: ${elapsed} elapsed, ${toolCalls} tool call${toolCalls === 1 ? '' : 's'}${lastTool}${failureNote}. ` +
    `Wait for the task notification, or re-run /agy:result ${job.id} later.\n`
  );
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
      process.stdout.write(renderRunning(resolved.job));
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
