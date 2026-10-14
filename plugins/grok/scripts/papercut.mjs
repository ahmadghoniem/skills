#!/usr/bin/env node
// Records a manually authored papercut: what grok's closing report said got in
// its way, quoted rather than diagnosed, or the resolution of an earlier cut.
// `delegate.mjs` logs `detected` warnings automatically; `/grok:update`
// reviews the clusters.
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { appendPapercut, pluginVersion, readPapercuts } from './lib/papercuts.mjs';
import { parseVersion, versionInfo } from './lib/grok.mjs';
import { jobsDir, papercutsPath } from './lib/paths.mjs';
import { readJob } from './lib/jobs.mjs';

const USAGE = `Usage: /grok:papercut --text "<what went wrong>"
                    [--fix "<what would have prevented it>"]
                    [--job <job-id>] [--quote "<the delegatee's own words>"]
       /grok:papercut --resolve <key|id> --note "<what was changed>"
`;

/**
 * The installed grok version, or undefined when `grok --version` does not answer.
 *
 * @returns {Promise<string|undefined>}
 */
async function toolVersion() {
  const info = await versionInfo().catch(() => null);
  return (info?.ok && parseVersion(info.detail)) || undefined;
}

/**
 * Append a resolution row. A key closes every cut in that group recorded
 * before now; an id closes one cut. The log is never rewritten: a fix that
 * stops working shows up as its key reappearing after this row's date.
 *
 * @param {string} target
 * @param {unknown} rawNote
 * @returns {number}
 */
function resolveCut(target, rawNote) {
  const cuts = readPapercuts().filter((c) => !c.resolves);
  const byKey = cuts.some((c) => c.key === target);
  if (!byKey && !cuts.some((c) => c.id === target)) {
    process.stderr.write(`Error: no papercut key or id \`${target}\` in ${papercutsPath()}.\n`);
    return 2;
  }
  const note = typeof rawNote === 'string' ? rawNote.trim() : '';
  if (!note) {
    process.stderr.write('Error: --resolve needs --note saying what was changed.\n');
    return 2;
  }
  const id = appendPapercut({
    ts: new Date().toISOString(),
    source: 'resolution',
    pluginVersion,
    text: note,
    resolves: target,
  });
  process.stdout.write(`resolved ${byKey ? 'key' : 'cut'} \`${target}\` (recorded as \`${id}\`).\n`);
  return 0;
}

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

  if (typeof flags.resolve === 'string' && flags.resolve.trim()) {
    return resolveCut(flags.resolve.trim(), flags.note);
  }

  const text = typeof flags.text === 'string' ? flags.text.trim() : '';
  if (!text) {
    process.stderr.write('Error: --text is required.\n');
    process.stderr.write(USAGE);
    return 2;
  }

  // Populate run identity (model, session) from the existing job record.
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

  const id = appendPapercut({
    ts: new Date().toISOString(),
    source: 'narrated',
    key: 'narrated',
    text,
    toolVersion: await toolVersion(),
    pluginVersion,
    model: typeof job?.model === 'string' && job.model ? job.model : undefined,
    repo: root,
    jobId: job ? job.id : undefined,
    sessionId: typeof job?.grokSessionId === 'string' ? job.grokSessionId : undefined,
    fix: typeof flags.fix === 'string' && flags.fix.trim() ? flags.fix.trim() : undefined,
    evidence: Object.keys(evidence).length ? evidence : undefined,
  });

  if (!id) {
    process.stderr.write('Error: could not write to the papercut log.\n');
    return 1;
  }
  process.stdout.write(`papercut \`${id}\` recorded.\n`);
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
