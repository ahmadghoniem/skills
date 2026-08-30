#!/usr/bin/env node
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { jobNotFoundMessage } from './lib/hints.mjs';
import { cancelJob, findRunningJobs, isPidGone, readJob } from './lib/jobs.mjs';

/**
 * Snapshot liveness of the grok CLI pid and the wrapper pid *before* we
 * tree-kill, so the user-facing line can say which ones were already gone.
 *
 * @param {import('./lib/jobs.mjs').JobRecord} job
 * @returns {string[]}
 */
function pidLivenessBits(job) {
  /** @type {string[]} */
  const bits = [];
  if (typeof job.cliPid === 'number') {
    bits.push(
      isPidGone(job.cliPid)
        ? `cli pid ${job.cliPid} already gone`
        : `cli pid ${job.cliPid} still live`,
    );
  }
  if (typeof job.pid === 'number') {
    bits.push(
      isPidGone(job.pid)
        ? `wrapper pid ${job.pid} already gone`
        : `wrapper pid ${job.pid} still live`,
    );
  }
  return bits;
}

function allPidsAlreadyGone(bits) {
  return bits.length === 0 || bits.every((b) => b.endsWith('already gone'));
}

function reportBitsAfterCancel(bits) {
  return bits.map((b) => b.replace('still live', 'killed')).join(', ');
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { positional } = parseCommandArgv(rawArgv);
  const root = await repoRoot(process.cwd());
  let id = positional[0];
  if (!id) {
    const running = findRunningJobs(root);
    if (running.length === 0) {
      process.stdout.write('No running Grok jobs to cancel.\n');
      return 0;
    }
    if (running.length > 1) {
      process.stderr.write(
        `Multiple running jobs (${running.length}). Pass an explicit id, e.g. \`/grok:cancel ${running[0]?.id}\`.\n`,
      );
      return 2;
    }
    id = running[0]?.id;
  }
  if (!id) {
    process.stderr.write('No job id resolved.\n');
    return 2;
  }
  const before = readJob(root, id);
  const liveness =
    before && before.status === 'running' ? pidLivenessBits(before) : [];
  const goneBefore = Boolean(before && before.status === 'running' && allPidsAlreadyGone(liveness));
  const updated = await cancelJob(root, id);
  if (!updated) {
    process.stderr.write(jobNotFoundMessage(id));
    return 1;
  }
  if (before && before.status !== 'running') {
    process.stdout.write(
      `Job \`${updated.id}\` was not running (already ${updated.status}); nothing to cancel.\n`,
    );
    return 0;
  }
  const pidBit = liveness.length ? ` (${reportBitsAfterCancel(liveness)})` : '';
  if (goneBefore) {
    process.stdout.write(
      `Job \`${updated.id}\` process was already gone${pidBit}; record marked as cancelled.\n`,
    );
    return 0;
  }
  process.stdout.write(`Job \`${updated.id}\` marked as ${updated.status}${pidBit}.\n`);
  return 0;
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`cancel failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
