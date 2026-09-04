#!/usr/bin/env node
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { mostRecentJob, resolveJob } from './lib/jobs.mjs';
import { main as delegateMain } from './delegate.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resume a conversation by delegating with `--conversation <uuid>` or
 * `--continue`. A job id or uuid resolves to that conversation; otherwise this
 * repo's most recent tracked job supplies one. `--continue` is the last resort
 * and resumes agy's most recent conversation machine-wide, which may belong to
 * another repository.
 *
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { positional, flags } = parseCommandArgv(rawArgv, ['sandbox', 'continue']);

  const explicit = rawArgv.some(
    (a) => a === '--conversation' || a.startsWith('--conversation=') || a === '--continue',
  );
  if (explicit) return delegateMain(rawArgv);

  const root = await repoRoot(process.cwd());
  const first = positional[0];
  if (first) {
    if (UUID_RE.test(first)) return dispatchWithConversation(first, positional.slice(1), flags);
    const resolved = resolveJob(root, first);
    if (resolved.error) {
      process.stderr.write(`${resolved.error}\n`);
      return 2;
    }
    if (resolved.job?.conversationId) {
      return dispatchWithConversation(resolved.job.conversationId, positional.slice(1), flags);
    }
    // First token is not a job id; treat all tokens as follow-up.
  }
  const recent = mostRecentJob(root);
  const resume = recent?.conversationId ? ['--conversation', recent.conversationId] : ['--continue'];
  return delegateMain([...resume, ...rawArgv]);
}

/**
 * @param {string} conversationId
 * @param {string[]} rest
 * @param {Record<string, unknown>} flags
 */
async function dispatchWithConversation(conversationId, rest, flags) {
  /** @type {string[]} */
  const rebuilt = ['--conversation', conversationId];
  if (flags.sandbox) rebuilt.push('--sandbox');
  if (typeof flags.model === 'string') rebuilt.push('--model', flags.model);
  if (typeof flags.effort === 'string') rebuilt.push('--effort', flags.effort);
  if (flags.timeout != null) rebuilt.push('--timeout', String(flags.timeout));
  if (flags['no-git-check'] === true || flags.gitCheck === false) {
    rebuilt.push('--no-git-check');
  }
  rebuilt.push(...rest);
  return delegateMain(rebuilt);
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`resume failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
