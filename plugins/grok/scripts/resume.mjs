#!/usr/bin/env node
import { main as delegateMain } from './delegate.mjs';
import { invokedAsScript } from './lib/args.mjs';

/**
 * Resume the grok session a job recorded, with an optional follow-up prompt.
 * Same job-recording path as `/grok:delegate` — `--resume` is injected when the
 * caller did not pass one, and `delegate.mjs` refuses it without a job id.
 *
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const argv = rawArgv.slice();
  const hasResume = argv.some((a) => a === '--resume' || a.startsWith('--resume='));
  if (!hasResume) argv.unshift('--resume');
  return delegateMain(argv);
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`resume failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
