#!/usr/bin/env node
import { invokedAsScript, parseCommandArgv } from './lib/util/args.mjs';
import { repoRoot } from './lib/util/git.mjs';
import { cancelJob, findRunningJobs, resolveJob } from './lib/jobs.mjs';
import { isPidGone } from './lib/util/killtree.mjs';

/**
 * Check liveness of the agy CLI and wrapper PIDs before killing the tree.
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
      process.stdout.write('No running agy jobs to cancel.\n');
      return 0;
    }
    if (running.length > 1) {
      process.stderr.write(
        `Multiple running jobs (${running.length}). Pass an explicit id, e.g. \`/agy:cancel ${running[0].id}\`.\n`,
      );
      return 2;
    }
    id = running[0].id;
  }
  const resolved = resolveJob(root, id);
  if (resolved.error) {
    process.stderr.write(`${resolved.error}\n`);
    return 2;
  }
  const before = resolved.job;
  if (!before) {
    process.stderr.write(`No job matching '${id}' for this repository.\n`);
    return 1;
  }
  const liveness = before.status === 'running' ? pidLivenessBits(before) : [];
  const goneBefore = before.status === 'running' && allPidsAlreadyGone(liveness);
  const updated = await cancelJob(root, before.id);
  if (!updated) {
    process.stderr.write(`No job matching '${id}' for this repository.\n`);
    return 1;
  }
  if (before.status !== 'running') {
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
