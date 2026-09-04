#!/usr/bin/env node
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { mostRecentJob, resolveJob } from './lib/jobs.mjs';
import { main as delegateMain } from './delegate.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resume a specific conversation or the most recent one for this working
 * directory by delegating with `--conversation <uuid>` or `--continue`.
 *
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { positional, flags } = parseCommandArgv(rawArgv, ['sandbox', 'continue']);

  const argv = rawArgv.slice();
  const hasConversation = argv.some((a) => a === '--conversation' || a.startsWith('--conversation='));
  const hasContinue = argv.some((a) => a === '--continue');

  if (!hasConversation && !hasContinue) {
    const first = positional[0];
    if (first && UUID_RE.test(first)) {
      argv.push('--conversation', first);
      // Pass the uuid via `--conversation` and forward remaining positional tokens.
      return dispatchWithConversation(first, positional.slice(1), flags, argv);
    }
    if (first) {
      const root = await repoRoot(process.cwd());
      const resolved = resolveJob(root, first);
      if (resolved.error) {
        process.stderr.write(`${resolved.error}\n`);
        return 2;
      }
      if (resolved.job?.conversationId) {
        return dispatchWithConversation(
          resolved.job.conversationId,
          positional.slice(1),
          flags,
          argv,
        );
      }
      // First token is not a job id; treat all tokens as follow-up.
    }
    const root = await repoRoot(process.cwd());
    const recent = mostRecentJob(root);
    if (recent?.conversationId) {
      argv.unshift('--conversation', recent.conversationId);
    } else {
      argv.unshift('--continue');
    }
  }
  return delegateMain(argv);
}

/**
 * @param {string} conversationId
 * @param {string[]} rest
 * @param {Record<string, unknown>} flags
 * @param {string[]} originalArgv
 */
async function dispatchWithConversation(conversationId, rest, flags, originalArgv) {
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
  void originalArgv;
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
