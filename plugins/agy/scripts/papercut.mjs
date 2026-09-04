#!/usr/bin/env node
// Write one papercut by hand — the two rows only a reader can supply.
// `delegate.mjs` writes the `detected` rows on its own.
//
//   narrated      what agy said blocked it, quoted by the runner agent from
//                 agy's closing report.
//   orchestrator  a failure the brief caused, recorded by whoever wrote it:
//                 expected, got, and the failing clause.
//
// Both record what happened and never why. `/agy:kaizen` does the reading,
// later, with fresh context.
import { readFileSync } from 'node:fs';
import { collapseCommandArgv, invokedAsScript, parseArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { appendPapercut, pluginVersion } from './lib/papercuts.mjs';
import { cachedToolVersion } from './lib/agy.mjs';
import { jobsDir } from './lib/paths.mjs';
import { readJob } from './lib/jobs.mjs';

const USAGE = `Usage: /agy:papercut --source <narrated|orchestrator> --text "<what went wrong>"
                    [--fix "<what would have prevented it>"]
                    [--severity warn|info] [--job <job-id>]
                    [--quote "<the delegatee's own words>"]
                    [--brief-excerpt "<the failing clause of the brief>"]
                    [--expected "<what the brief asked for>"]
                    [--got "<what came back>"]
`;

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { flags } = parseArgv(collapseCommandArgv(rawArgv), ['help'], {
    honorDoubleDash: false,
  });

  if (flags.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const source = typeof flags.source === 'string' ? flags.source.trim() : '';
  if (source !== 'narrated' && source !== 'orchestrator') {
    process.stderr.write('Error: --source must be `narrated` or `orchestrator`.\n');
    process.stderr.write(USAGE);
    return 2;
  }

  const text = typeof flags.text === 'string' ? flags.text.trim() : '';
  if (!text) {
    process.stderr.write('Error: --text is required.\n');
    process.stderr.write(USAGE);
    return 2;
  }

  // A job id fills in the run's identity — model, conversation, effort — so the
  // caller does not have to retype facts the plugin already recorded.
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
  if (typeof flags['brief-excerpt'] === 'string' && flags['brief-excerpt'].trim()) {
    evidence.briefExcerpt = flags['brief-excerpt'].trim();
  }
  if (typeof flags.expected === 'string' && flags.expected.trim()) {
    evidence.expected = flags.expected.trim();
  }
  if (typeof flags.got === 'string' && flags.got.trim()) evidence.got = flags.got.trim();

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
    toolCalls: undefined,
    filesChanged: Array.isArray(job?.gitFiles) ? job.gitFiles.length : undefined,
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
