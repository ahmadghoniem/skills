#!/usr/bin/env node
import { collapseCommandArgv, invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { listJobs, resolveJob } from './lib/jobs.mjs';
import { main as delegateMain } from './delegate.mjs';

/** Session ids look like `ses_f44f661a1ffemVReM1MqGamB9x`. */
const SESSION_RE = /^ses_[A-Za-z0-9]+$/;

/**
 * Resume by delegating with `--session <id>`. A job id or a session id picks
 * the session directly; otherwise the newest job in this repository that
 * recorded one supplies it.
 *
 * When nothing in this repository has a session, this reports that and stops
 * rather than falling back to opencode's own `--continue`, which resumes the
 * most recent session on the machine and may belong to a different project.
 * An explicit `--continue` the user passes themselves still goes through
 * untouched.
 *
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { positional } = parseCommandArgv(rawArgv, ['continue', 'fork']);

  const explicit = rawArgv.some(
    (a) => a === '--session' || a.startsWith('--session=') || a === '--continue',
  );
  if (explicit) return delegateMain(rawArgv);

  const root = await repoRoot(process.cwd());
  const first = positional[0];
  if (first) {
    if (SESSION_RE.test(first)) return dispatchWithSession(first, rawArgv, first);
    const resolved = resolveJob(root, first);
    if (resolved.error) {
      process.stderr.write(`${resolved.error}\n`);
      return 2;
    }
    if (resolved.job?.sessionId) {
      return dispatchWithSession(resolved.job.sessionId, rawArgv, first);
    }
    // First token is not a job id; treat all tokens as follow-up text.
  }
  const recent = listJobs(root).find((j) => typeof j.sessionId === 'string' && j.sessionId);
  if (!recent) {
    process.stderr.write(
      'No resumable opencode job in this repository. Pass a job id or a session id (ses_…).\n',
    );
    return 2;
  }
  return dispatchWithSession(recent.sessionId, rawArgv, undefined);
}

/**
 * @param {string} sessionId
 * @param {string[]} rawArgv
 * @param {string|undefined} jobToken
 */
async function dispatchWithSession(sessionId, rawArgv, jobToken) {
  const tokens = collapseCommandArgv(rawArgv); // expands --arg-string, strips `--`
  const i = jobToken === undefined ? -1 : tokens.indexOf(jobToken);
  if (i !== -1) tokens.splice(i, 1);
  return delegateMain(['--session', sessionId, ...tokens]);
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`resume failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
