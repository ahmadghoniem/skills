import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { ensureDir, jobsDir, logsDir, pluginHome } from './paths.mjs';

/**
 * @typedef {'running'|'done'|'failed'|'cancelled'} JobStatus
 */

/**
 * @typedef {Object} JobRecord
 * @property {string} id
 * @property {string} repoPath
 * @property {string} prompt
 * @property {string} model
 * @property {string=} grokSessionId
 * @property {number=} pid
 * @property {JobStatus} status
 * @property {number=} exitCode
 * @property {string} startedAt
 * @property {string=} finishedAt
 * @property {string} rawLogPath
 * @property {string=} summary
 * @property {string[]=} filesTouched
 * @property {boolean=} background
 * @property {boolean=} cloud
 */

/**
 * @typedef {Object} CreateJobInit
 * @property {string} id
 * @property {string} repoPath
 * @property {string} prompt
 * @property {string} model
 * @property {boolean=} background
 * @property {boolean=} cloud
 */

/**
 * @param {string} repoPath
 * @param {string} id
 */
export function jobFilePath(repoPath, id) {
  return join(jobsDir(repoPath), `${id}.json`);
}

/**
 * @param {string} repoPath
 * @param {string} id
 */
export function rawLogPath(repoPath, id) {
  return join(logsDir(repoPath), `${id}.ndjson`);
}

function atomicWrite(target, data) {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, 'utf8');
  try {
    renameSync(tmp, target);
  } catch (err) {
    // Don't leave the temp file behind if the rename fails.
    try {
      unlinkSync(tmp);
    } catch {
      // noop
    }
    throw err;
  }
}

/**
 * @param {CreateJobInit} init
 * @returns {JobRecord}
 */
export function createJob(init) {
  ensureDir(jobsDir(init.repoPath));
  ensureDir(logsDir(init.repoPath));
  /** @type {JobRecord} */
  const record = {
    id: init.id,
    repoPath: init.repoPath,
    prompt: init.prompt,
    model: init.model,
    status: 'running',
    startedAt: new Date().toISOString(),
    rawLogPath: rawLogPath(init.repoPath, init.id),
    ...(init.background ? { background: true } : {}),
    ...(init.cloud ? { cloud: true } : {}),
  };
  atomicWrite(jobFilePath(init.repoPath, init.id), JSON.stringify(record, null, 2));
  return record;
}

/**
 * Locate a job's JSON file on disk.
 *
 * Ids are 10-char random base64url strings — globally unique in practice —
 * so when the direct `<repoPath's jobsDir>/<id>.json` guess misses (e.g. the
 * caller's cwd resolved to a different, or no, git root than the process
 * that created the job — easy to hit when `delegate` and a later `status`/
 * `result` call run in separate shells/agent turns with drifted cwd), fall
 * back to scanning every repo's job dir under the plugin home for a file
 * named `<id>.json`. This is what makes id-based lookups (status, result,
 * cancel, updateJob) reliable regardless of which repoPath the caller
 * happens to compute (issue A).
 *
 * @param {string} repoPath
 * @param {string} id
 * @returns {string|null} Absolute path to the job file, or null if not found.
 */
function locateJobFile(repoPath, id) {
  const direct = jobFilePath(repoPath, id);
  if (existsSync(direct)) return direct;
  const jobsRoot = join(pluginHome(), 'jobs');
  if (!existsSync(jobsRoot)) return null;
  let entries;
  try {
    entries = readdirSync(jobsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(jobsRoot, entry.name, `${id}.json`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Path to the completion sentinel for a job (issue C) — an empty file
 * written next to the job's JSON record once it reaches a terminal status.
 * A caller can watch/poll for this file's existence instead of parsing the
 * JSON record or tailing the NDJSON log to learn "is it done yet".
 *
 * @param {string} repoPath
 * @param {string} id
 */
export function jobDonePath(repoPath, id) {
  return join(jobsDir(repoPath), `${id}.done`);
}

/**
 * @param {string} repoPath
 * @param {string} id
 * @returns {JobRecord|null}
 */
export function readJob(repoPath, id) {
  const file = locateJobFile(repoPath, id);
  if (!file) return null;
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {string} repoPath
 * @param {string} id
 * @param {Partial<JobRecord>} patch
 * @returns {JobRecord|null}
 */
export function updateJob(repoPath, id, patch) {
  const file = locateJobFile(repoPath, id);
  if (!file) return null;
  let existing;
  try {
    existing = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const merged = { ...existing, ...patch };
  // Read-modify-write is last-writer-wins; the one race we actively guard is a
  // background worker finishing (status → done/failed) AFTER the user cancelled
  // the job. A cancellation is terminal and must not be silently overwritten.
  if (existing.status === 'cancelled' && patch.status && patch.status !== 'cancelled') {
    merged.status = 'cancelled';
  }
  // Write back to the file we actually found `existing` at — not a path
  // recomputed from `repoPath` — so a `locateJobFile` fallback hit never
  // creates a stray duplicate record in the "wrong" repo's job dir.
  atomicWrite(file, JSON.stringify(merged, null, 2));
  // Completion sentinel (issue C): best-effort, written whenever the job
  // reaches a terminal status. A failure here must not fail the status
  // update itself — the JSON record remains the source of truth.
  if (merged.status && merged.status !== 'running') {
    try {
      writeFileSync(join(dirname(file), `${id}.done`), '', 'utf8');
    } catch {
      // noop
    }
  }
  return merged;
}

/**
 * @typedef {Object} ListOpts
 * @property {number=} limit
 * @property {JobStatus=} status
 */

/**
 * @param {string} repoPath
 * @param {ListOpts} [opts]
 * @returns {JobRecord[]}
 */
export function listJobs(repoPath, opts = {}) {
  const dir = jobsDir(repoPath);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.includes('.tmp-'));
  /** @type {JobRecord[]} */
  const records = [];
  for (const f of files) {
    try {
      const raw = readFileSync(join(dir, f), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string')
        records.push(parsed);
    } catch {
      continue;
    }
  }
  records.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const filtered = opts.status ? records.filter((r) => r.status === opts.status) : records;
  return typeof opts.limit === 'number' ? filtered.slice(0, opts.limit) : filtered;
}

/**
 * @param {string} repoPath
 * @param {number} [days]
 * @returns {number}
 */
export function pruneOlderThanDays(repoPath, days = 30) {
  const dir = jobsDir(repoPath);
  if (!existsSync(dir)) return 0;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    try {
      const st = statSync(p);
      if (st.isFile() && st.mtimeMs < cutoff) {
        unlinkSync(p);
        removed += 1;
      }
    } catch {
      continue;
    }
  }
  const lDir = logsDir(repoPath);
  if (existsSync(lDir)) {
    for (const f of readdirSync(lDir)) {
      const p = join(lDir, f);
      try {
        const st = statSync(p);
        if (st.isFile() && st.mtimeMs < cutoff) unlinkSync(p);
      } catch {
        continue;
      }
    }
  }
  return removed;
}

/**
 * True when `pid` refers to no process (`process.kill(pid, 0)` throws `ESRCH`).
 * Other errors (EPERM) mean the pid still names a process we cannot signal.
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function isPidGone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return Boolean(err && typeof err === 'object' && err.code === 'ESRCH');
  }
}

/**
 * @param {string} repoPath
 * @param {string} id
 * @param {number} [graceMs]
 * @returns {Promise<JobRecord|null>}
 */
export async function cancelJob(repoPath, id, graceMs = 5_000) {
  const job = readJob(repoPath, id);
  if (!job) return null;
  if (job.status !== 'running') return job;
  // NOTE: PIDs are recycled by the OS. If the original process already exited
  // and its PID was reused, the signals below could hit an unrelated process.
  // The job dir is short-lived and pruned after 30 days, so we accept this
  // rather than track a process-group / start-time identity cross-platform.
  if (typeof job.pid === 'number' && !isPidGone(job.pid)) {
    try {
      process.kill(job.pid, 'SIGTERM');
    } catch {
      // ignore — may have exited
    }
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline && !isPidGone(job.pid)) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!isPidGone(job.pid)) {
      try {
        process.kill(job.pid, 'SIGKILL');
      } catch {
        // ignore
      }
    }
  }
  return updateJob(repoPath, id, {
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
  });
}

/**
 * @param {string} repoPath
 * @returns {JobRecord[]}
 */
export function findRunningJobs(repoPath) {
  return listJobs(repoPath).filter((j) => j.status === 'running');
}

/**
 * @param {string} repoPath
 * @returns {JobRecord|null}
 */
export function mostRecentFinishedJob(repoPath) {
  const jobs = listJobs(repoPath).filter((j) => j.status !== 'running');
  return jobs[0] ?? null;
}
