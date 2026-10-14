#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { listJobs, mostRecentFinishedJob, resolveJob } from './lib/jobs.mjs';
import { parseLine } from './lib/parse.mjs';
import { renderResult } from './lib/render.mjs';

function renderList(jobs) {
  if (jobs.length === 0) return 'No grok jobs tracked for this repository yet.\n';
  const lines = ['id  status  started', ''];
  for (const j of jobs) {
    lines.push(`${j.id}  ${j.status}  ${j.startedAt}`);
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
 * Tool calls in the event log written so far, and the last tool's name.
 *
 * @param {string|undefined} path
 * @returns {{toolCalls: number, lastTool: string|undefined}}
 */
function progress(path) {
  let raw = '';
  try {
    raw = path ? readFileSync(path, 'utf8') : '';
  } catch {
    // not written yet
  }
  let toolCalls = 0;
  let lastTool;
  for (const line of raw.split('\n')) {
    const ev = parseLine(line);
    if (ev?.type !== 'tool_call') continue;
    toolCalls += 1;
    if (typeof ev.toolName === 'string') lastTool = ev.toolName;
  }
  return { toolCalls, lastTool };
}

/**
 * A running job has no write-up yet, so `renderResult` cannot be used. Print
 * one progress line read from the job's event log instead.
 *
 * @param {import('./lib/jobs.mjs').JobRecord} job
 * @returns {string}
 */
function renderRunning(job) {
  const { toolCalls, lastTool } = progress(job.rawLogPath);
  const elapsed = formatElapsed(Date.now() - Date.parse(job.startedAt));
  const last = lastTool ? `, last tool ${lastTool}` : '';
  return (
    `Job \`${job.id}\` is still running: ${elapsed} elapsed, ${toolCalls} tool call${toolCalls === 1 ? '' : 's'}${last}. ` +
    `Wait for the task notification, or re-run /grok:result ${job.id} later.\n`
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
    process.stderr.write('No finished grok jobs tracked for this repository yet.\n');
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
