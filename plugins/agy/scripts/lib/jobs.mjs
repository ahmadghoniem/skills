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
import { isPidGone, killTree } from './killtree.mjs';
import { ensureDir, jobsDir, pluginHome } from './paths.mjs';
import { jobName } from './slug.mjs';

export { isPidGone };

/**
 * @typedef {'running'|'done'|'failed'|'cancelled'} JobStatus
 */

/**
 * @typedef {Object} JobRecord
 * @property {string} id
 * @property {string} repoPath
 * @property {string} prompt
 * @property {string} model
 * @property {string=} effort
 * @property {string=} conversationId
 * @property {number=} pid
 * @property {number=} cliPid
 * @property {JobStatus} status
 * @property {string|null=} agyStatus
 * @property {number=} exitCode
 * @property {string} startedAt
 * @property {string=} finishedAt
 * @property {string} rawLogPath
 * @property {string} agyLogPath
 * @property {string} promptPath
 * @property {string=} summary
 * @property {string[]=} stderrTail
 * @property {{tool: string, message: string}[]=} toolErrors
 * @property {string|null=} error
 * @property {number=} durationSeconds
 * @property {boolean=} gitRepo
 * @property {Array<{status: string, path: string}>=} gitBefore
 * @property {Array<{status: string, path: string}>=} gitFiles
 * @property {boolean=} claimedFileChanges
 * @property {boolean=} background
 * @property {boolean=} killed
 * @property {boolean=} sandbox
 */

/**
 * @typedef {Object} CreateJobInit
 * @property {string} id
 * @property {string} repoPath
 * @property {string} prompt
 * @property {string} model
 * @property {boolean=} background
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
  return join(jobsDir(repoPath), `${id}.ndjson`);
}

/**
 * @param {string} repoPath
 * @param {string} id
 */
export function agyLogPath(repoPath, id) {
  return join(jobsDir(repoPath), `${id}.agy.log`);
}

/**
 * @param {string} repoPath
 * @param {string} id
 */
export function promptPath(repoPath, id) {
  return join(jobsDir(repoPath), `${id}.prompt.md`);
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
  /** @type {JobRecord} */
  const record = {
    id: init.id,
    repoPath: init.repoPath,
    prompt: init.prompt,
    model: init.model,
    status: 'running',
    startedAt: new Date().toISOString(),
    rawLogPath: rawLogPath(init.repoPath, init.id),
    agyLogPath: agyLogPath(init.repoPath, init.id),
    promptPath: promptPath(init.repoPath, init.id),
    ...(init.background ? { background: true } : {}),
  };
  atomicWrite(jobFilePath(init.repoPath, init.id), JSON.stringify(record, null, 2));
  return record;
}

/**
 * Locate a job's JSON file on disk.
 *
 * When the direct `<repoPath's jobsDir>/<id>.json` guess misses (cwd drifted
 * between dispatch and a later result/cancel), fall back to scanning every
 * repo's job dir under the plugin home for a file named `<id>.json`.
 *
 * @param {string} repoPath
 * @param {string} id
 * @returns {string|null}
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
 * @param {string} repoPath
 * @param {string} id
 */
export function jobDonePath(repoPath, id) {
  return join(jobsDir(repoPath), `${id}.done`);
}

/**
 * @param {string} file
 * @returns {JobRecord|null}
 */
function readJobFile(file) {
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
 * @returns {JobRecord|null}
 */
export function readJob(repoPath, id) {
  const file = locateJobFile(repoPath, id);
  if (!file) return null;
  return readJobFile(file);
}

/**
 * Collect every job record under the plugin home.
 *
 * @returns {JobRecord[]}
 */
function allJobs() {
  const jobsRoot = join(pluginHome(), 'jobs');
  if (!existsSync(jobsRoot)) return [];
  let entries;
  try {
    entries = readdirSync(jobsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  /** @type {JobRecord[]} */
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(jobsRoot, entry.name);
    let files;
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.json') || f.includes('.tmp-')) continue;
      const parsed = readJobFile(join(dir, f));
      if (parsed) records.push(parsed);
    }
  }
  return records;
}

/**
 * Resolve a job by full name, unique prefix, or 4-char suffix.
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

  const local = listJobs(repoPath);
  const localHit = matchQuery(local, q);
  if (localHit.job || localHit.error) return localHit;

  const globalHit = matchQuery(allJobs(), q);
  if (globalHit.job || globalHit.error) return globalHit;
  return { job: null, error: null };
}

/**
 * @param {JobRecord[]} pool
 * @param {string} q
 * @returns {{job: JobRecord|null, error: string|null}}
 */
function matchQuery(pool, q) {
  const prefixHits = pool.filter((j) => j.id.startsWith(q));
  if (prefixHits.length === 1) return { job: prefixHits[0] ?? null, error: null };
  if (prefixHits.length > 1) {
    return {
      job: null,
      error: `Ambiguous job id '${q}': ${prefixHits.map((j) => j.id).join(', ')}`,
    };
  }
  const suffixHits = pool.filter((j) => j.id.endsWith(`-${q}`));
  if (suffixHits.length === 1) return { job: suffixHits[0] ?? null, error: null };
  if (suffixHits.length > 1) {
    return {
      job: null,
      error: `Ambiguous job suffix '${q}': ${suffixHits.map((j) => j.id).join(', ')}`,
    };
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
  // Read-modify-write is last-writer-wins; the one race we actively guard is a
  // background worker finishing (status → done/failed) AFTER the user cancelled
  // the job. A cancellation is terminal and must not be silently overwritten.
  if (existing.status === 'cancelled' && patch.status && patch.status !== 'cancelled') {
    merged.status = 'cancelled';
  }
  atomicWrite(file, JSON.stringify(merged, null, 2));
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
    const parsed = readJobFile(join(dir, f));
    if (parsed) records.push(parsed);
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
  return removed;
}

/**
 * @param {string} repoPath
 * @param {string} id
 * @param {number} [graceMs]
 * @returns {Promise<JobRecord|null>}
 */
export async function cancelJob(repoPath, id, graceMs = 5_000) {
  const resolved = resolveJob(repoPath, id);
  const job = resolved.job;
  if (!job) return null;
  if (job.status !== 'running') return job;
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

/**
 * @param {string} repoPath
 * @returns {JobRecord|null}
 */
export function mostRecentJob(repoPath) {
  const jobs = listJobs(repoPath);
  return jobs[0] ?? null;
}
