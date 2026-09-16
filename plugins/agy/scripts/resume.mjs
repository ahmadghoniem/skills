#!/usr/bin/env node
import { collapseCommandArgv, invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { listJobs, resolveJob } from './lib/jobs.mjs';
import { main as delegateMain } from './delegate.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resume a conversation by delegating with `--conversation <uuid>`. A job id
 * or uuid resolves to that conversation; otherwise the newest job in this
 * repository that has a conversation id supplies one. If none has one, this
 * reports the failure and returns 2 rather than falling back to agy's own
 * `--continue`, which resumes machine-wide and may belong to another
 * repository. An explicit `--continue` the user passes themselves still goes
 * through untouched.
 *
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { positional } = parseCommandArgv(rawArgv, ['sandbox', 'continue']);

  const explicit = rawArgv.some(
    (a) => a === '--conversation' || a.startsWith('--conversation=') || a === '--continue',
  );
  if (explicit) return delegateMain(rawArgv);

  const root = await repoRoot(process.cwd());
  const first = positional[0];
  if (first) {
    if (UUID_RE.test(first)) return dispatchWithConversation(first, rawArgv, first);
    const resolved = resolveJob(root, first);
    if (resolved.error) {
      process.stderr.write(`${resolved.error}\n`);
      return 2;
    }
    if (resolved.job?.conversationId) {
      return dispatchWithConversation(resolved.job.conversationId, rawArgv, first);
    }
    // First token is not a job id; treat all tokens as follow-up.
  }
  const recent = listJobs(root).find((j) => typeof j.conversationId === 'string' && j.conversationId);
  if (!recent) {
    process.stderr.write('No resumable agy job in this repository. Pass a job id or a conversation uuid.\n');
    return 2;
  }
  return dispatchWithConversation(recent.conversationId, rawArgv, undefined);
}

/**
 * @param {string} conversationId
 * @param {string[]} rawArgv
 * @param {string|undefined} jobToken
 */
async function dispatchWithConversation(conversationId, rawArgv, jobToken) {
  const tokens = collapseCommandArgv(rawArgv); // expands --arg-string, strips `--`
  const i = jobToken === undefined ? -1 : tokens.indexOf(jobToken);
  if (i !== -1) tokens.splice(i, 1);
  return delegateMain(['--conversation', conversationId, ...tokens]);
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`resume failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
