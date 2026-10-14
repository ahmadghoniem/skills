#!/usr/bin/env node
import { collapseCommandArgv, invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { listJobs, resolveJob } from './lib/jobs.mjs';
import { main as delegateMain } from './delegate.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resume a grok session by delegating with `--session <uuid>`. A job id or
 * uuid resolves to that session; otherwise the newest job in this repository
 * that has a session id supplies one. If none has one, this reports the
 * failure and returns 2. It never falls back to grok's own `--continue`,
 * which picks grok's newest session in the directory, not necessarily one
 * this plugin started.
 *
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { positional } = parseCommandArgv(rawArgv, ['help']);

  const explicit = rawArgv.some((a) => a === '--session' || a.startsWith('--session='));
  if (explicit) return delegateMain(rawArgv);

  const root = await repoRoot(process.cwd());
  const first = positional[0];
  if (first) {
    if (UUID_RE.test(first)) return dispatchWithSession(first, rawArgv, first);
    const resolved = resolveJob(root, first);
    if (resolved.error) {
      process.stderr.write(`${resolved.error}\n`);
      return 2;
    }
    if (resolved.job?.grokSessionId) {
      return dispatchWithSession(resolved.job.grokSessionId, rawArgv, first);
    }
    // First token is not a job id; treat all tokens as follow-up.
  }
  const recent = listJobs(root).find((j) => typeof j.grokSessionId === 'string' && j.grokSessionId);
  if (!recent) {
    process.stderr.write('No resumable grok job in this repository. Pass a job id or a session uuid.\n');
    return 2;
  }
  return dispatchWithSession(recent.grokSessionId, rawArgv, undefined);
}

/**
 * @param {string} grokSessionId
 * @param {string[]} rawArgv
 * @param {string|undefined} jobToken
 */
async function dispatchWithSession(grokSessionId, rawArgv, jobToken) {
  const tokens = collapseCommandArgv(rawArgv); // expands --arg-string, strips `--`
  const i = jobToken === undefined ? -1 : tokens.indexOf(jobToken);
  if (i !== -1) tokens.splice(i, 1);
  return delegateMain(['--session', grokSessionId, ...tokens]);
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`resume failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
