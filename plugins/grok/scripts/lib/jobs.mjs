import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { isPidGone, killTree } from './killtree.mjs';
import { ensureDir, jobsDir, logsDir, pluginHome } from './paths.mjs';
import { jobName } from './slug.mjs';

/**
 * @typedef {'running'|'done'|'failed'|'cancelled'|'orphaned'} JobStatus
 */

/**
 * @typedef {Object} JobRecord
 * @property {string} id
 * @property {string} repoPath
 * @property {string} prompt
 * @property {string} model          `''` when grok chose its account default
 * @property {string=} effort
 * @property {string=} grokSessionId  set once grok has started the session
 * @property {number=} pid
 * @property {number=} cliPid
 * @property {JobStatus} status
 * @property {number=} exitCode
 * @property {string} startedAt
 * @property {string=} finishedAt
 * @property {string} rawLogPath
 * @property {string=} briefPath
 * @property {string=} summary
 * @property {string=} stopReason
 * @property {string=} errorDetail
 * @property {boolean=} killed
 * @property {{command: string, exitCode: number|null, output: string, timedOut: boolean}[]=} failedCommands
 * @property {number=} toolCalls
 * @property {boolean=} gitRepo
 * @property {{status: string, path: string}[]=} gitFiles
 * @property {boolean=} claimedFileChanges
 */

/**
 * @typedef {Object} CreateJobInit
 * @property {string} id
 * @property {string} repoPath
 * @property {string} prompt
 * @property {string} model
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

/**
 * Allocate a job name that does not collide with an existing record.
 *
 * @param {string} repoPath
 * @param {string} text
 * @returns {string}
 */
export function uniqueJobName(repoPath, text) {
  ensureDir(jobsDir(repoPath));
  for (let i = 0; i < 16; i += 1) {
    const name = jobName(text);
    if (!existsSync(jobFilePath(repoPath, name))) return name;
  }
  throw new Error('could not allocate a unique job name');
}

function atomicWrite(target, data) {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, 'utf8');
  try {
    renameSync(tmp, target);
  } catch (err) {
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
  };
  atomicWrite(jobFilePath(init.repoPath, init.id), JSON.stringify(record, null, 2));
  return record;
}

/**
 * Every per-repository job directory under the plugin home.
 *
 * @returns {string[]}
 */
function repoJobDirs() {
  const jobsRoot = join(pluginHome(), 'jobs');
  let entries;
  try {
    entries = readdirSync(jobsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => join(jobsRoot, e.name));
}

/**
 * Every job record in one directory, skipping in-flight temp files.
 *
 * @param {string} dir
 * @returns {JobRecord[]}
 */
function readJobsIn(dir) {
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  /** @type {JobRecord[]} */
  const records = [];
  for (const f of files) {
    if (!f.endsWith('.json') || f.includes('.tmp-')) continue;
    const parsed = readJobFile(join(dir, f));
    if (parsed) records.push(parsed);
  }
  return records;
}

/**
 * Locate a job's JSON file on disk.
 *
 * Falls back to scanning every repository's job directory under the plugin home
 * when `<jobsDir>/<id>.json` is missing, so a lookup from a shell whose cwd
 * resolved to a different root still finds the job.
 *
 * @param {string} repoPath
 * @param {string} id
 * @returns {string|null}
 */
function locateJobFile(repoPath, id) {
  const direct = jobFilePath(repoPath, id);
  if (existsSync(direct)) return direct;
  for (const dir of repoJobDirs()) {
    const candidate = join(dir, `${id}.json`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * A `running` record whose wrapper died without writing a final record (the
 * Claude session closed, or a background task was stopped) stays `running`
 * forever otherwise. Mark it `orphaned` once both pids it captured are gone.
 *
 * A record with no `pid` yet has not started, so it is left alone.
 *
 * @param {JobRecord} record
 * @returns {JobRecord}
 */
function withOrphanCheck(record) {
  if (record.status !== 'running') return record;
  if (typeof record.pid !== 'number') return record;
  const pidGone = isPidGone(record.pid);
  const cliGone = typeof record.cliPid !== 'number' || isPidGone(record.cliPid);
  if (pidGone && cliGone) return { ...record, status: 'orphaned' };
  return record;
}

/**
 * @param {string} file
 * @returns {JobRecord|null}
 */
function readJobFile(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
      return withOrphanCheck(parsed);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {string} repoPath
 * @param {string} id
 * @returns {JobRecord|null}
 */
export function readJob(repoPath, id) {
  const file = locateJobFile(repoPath, id);
  if (!file) return null;
  return readJobFile(file);
}

/**
 * Resolve a job by full name, unique prefix, or 4-char suffix, within this
 * repository only. A full name still resolves across repositories, through
 * `locateJobFile`'s scan, since it names one specific job.
 *
 * @param {string} repoPath
 * @param {string} query
 * @returns {{job: JobRecord|null, error: string|null}}
 */
export function resolveJob(repoPath, query) {
  const q = String(query ?? '').trim();
  if (!q) return { job: null, error: null };

  const exact = readJob(repoPath, q);
  if (exact) return { job: exact, error: null };

  return matchQuery(listJobs(repoPath), q);
}

/**
 * @param {JobRecord[]} pool
 * @param {string} q
 * @returns {{job: JobRecord|null, error: string|null}}
 */
function matchQuery(pool, q) {
  for (const [label, hits] of [
    ['id', pool.filter((j) => j.id.startsWith(q))],
    ['suffix', pool.filter((j) => j.id.endsWith(`-${q}`))],
  ]) {
    if (hits.length === 1) return { job: hits[0], error: null };
    if (hits.length > 1) {
      return { job: null, error: `Ambiguous job ${label} '${q}': ${hits.map((j) => j.id).join(', ')}` };
    }
  }
  return { job: null, error: null };
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
  // A run finishing after the user cancelled it must not overwrite the
  // cancellation.
  if (existing.status === 'cancelled' && patch.status && patch.status !== 'cancelled') {
    merged.status = 'cancelled';
  }
  // Written back to the file `existing` came from, so a fallback hit in
  // another repository's directory never creates a duplicate record.
  atomicWrite(file, JSON.stringify(merged, null, 2));
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
  const records = readJobsIn(jobsDir(repoPath));
  records.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const filtered = opts.status ? records.filter((r) => r.status === opts.status) : records;
  return typeof opts.limit === 'number' ? filtered.slice(0, opts.limit) : filtered;
}

/**
 * Delete job records and logs not written to in `days` days.
 *
 * @param {string} repoPath
 * @param {number} [days]
 * @returns {number} job-directory files removed
 */
export function pruneOlderThanDays(repoPath, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const sweep = (dir) => {
    let removed = 0;
    let files;
    try {
      files = readdirSync(dir);
    } catch {
      return 0;
    }
    for (const f of files) {
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
    return removed;
  };
  const removed = sweep(jobsDir(repoPath));
  sweep(logsDir(repoPath));
  return removed;
}

/**
 * @param {string} repoPath
 * @param {string} id
 * @param {number} [graceMs]
 * @returns {Promise<JobRecord|null>}
 */
export async function cancelJob(repoPath, id, graceMs = 5_000) {
  const job = resolveJob(repoPath, id).job;
  if (!job) return null;
  if (job.status !== 'running') return job;
  // Kill the grok tree first: if the wrapper exits before `taskkill /T` walks
  // the CLI's tree, descendants can leak.
  if (typeof job.cliPid === 'number') {
    await killTree(job.cliPid, { graceMs });
  }
  if (typeof job.pid === 'number') {
    await killTree(job.pid, { graceMs });
  }
  return updateJob(job.repoPath, job.id, {
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
  });
}

/**
 * @param {string} repoPath
 * @returns {JobRecord[]}
 */
export function findRunningJobs(repoPath) {
  return listJobs(repoPath, { status: 'running' });
}

/**
 * @param {string} repoPath
 * @returns {JobRecord|null}
 */
export function mostRecentFinishedJob(repoPath) {
  return listJobs(repoPath).find((j) => j.status !== 'running') ?? null;
}
