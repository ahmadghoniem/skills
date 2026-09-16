#!/usr/bin/env node
// Records a manually authored papercut: what agy's closing report said got in
// its way, quoted rather than diagnosed. `delegate.mjs` logs `detected`
// anomalies automatically; `/agy:kaizen` clusters both.
import { readFileSync } from 'node:fs';
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { appendPapercut, pluginVersion } from './lib/papercuts.mjs';
import { cachedToolVersion } from './lib/agy.mjs';
import { jobsDir } from './lib/paths.mjs';
import { readJob } from './lib/jobs.mjs';

const USAGE = `Usage: /agy:papercut --source narrated --text "<what went wrong>"
                    [--fix "<what would have prevented it>"]
                    [--severity warn|info] [--job <job-id>]
                    [--quote "<the delegatee's own words>"]
`;

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { flags } = parseCommandArgv(rawArgv, ['help']);

  if (flags.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const source = typeof flags.source === 'string' ? flags.source.trim() : '';
  if (source !== 'narrated') {
    process.stderr.write('Error: --source must be `narrated`.\n');
    process.stderr.write(USAGE);
    return 2;
  }

  const text = typeof flags.text === 'string' ? flags.text.trim() : '';
  if (!text) {
    process.stderr.write('Error: --text is required.\n');
    process.stderr.write(USAGE);
    return 2;
  }

  // Populate run identity (model, conversation, changed files) from the existing job record.
  const root = await repoRoot(process.cwd());
  const jobId = typeof flags.job === 'string' ? flags.job.trim() : '';
  const job = jobId ? readJob(root, jobId) : null;
  if (jobId && !job) {
    process.stderr.write(`Error: no job \`${jobId}\` under ${jobsDir(root)}.\n`);
    return 2;
  }

  /** @type {Record<string, unknown>} */
  const evidence = {};
  if (typeof flags.quote === 'string' && flags.quote.trim()) evidence.quote = flags.quote.trim();

  const severity = flags.severity === 'info' ? 'info' : 'warn';

  const id = appendPapercut({
    ts: new Date().toISOString(),
    source,
    severity,
    tool: 'agy',
    toolVersion: cachedToolVersion() ?? undefined,
    pluginVersion,
    model: typeof job?.model === 'string' && job.model ? job.model : undefined,
    repo: root,
    jobId: job ? job.id : undefined,
    conversationId: typeof job?.conversationId === 'string' ? job.conversationId : undefined,
    text,
    fix: typeof flags.fix === 'string' && flags.fix.trim() ? flags.fix.trim() : undefined,
    evidence: Object.keys(evidence).length ? evidence : undefined,
  });

  if (!id) {
    process.stderr.write('Error: could not write to the papercut log.\n');
    return 1;
  }
  process.stdout.write(`papercut \`${id}\` recorded (${source}).\n`);
  return 0;
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `papercut failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(1);
    });
}
