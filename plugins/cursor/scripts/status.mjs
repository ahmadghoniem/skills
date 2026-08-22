#!/usr/bin/env node
import { parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { jobNotFoundMessage } from './lib/hints.mjs';
import { listJobs, readJob } from './lib/jobs.mjs';
import { renderJobTable } from './lib/jobtable.mjs';

function renderDetail(r) {
  const lines = [];
  lines.push(`### Job \`${r.id}\``);
  lines.push('');
  lines.push(`- **Status:** ${r.status}`);
  lines.push(`- **Model:** ${r.model}`);
  lines.push(`- **Started:** ${r.startedAt}`);
  if (r.finishedAt) lines.push(`- **Finished:** ${r.finishedAt}`);
  if (typeof r.exitCode === 'number') lines.push(`- **Exit code:** ${r.exitCode}`);
  if (r.pid) lines.push(`- **PID:** ${r.pid}`);
  if (r.cursorChatId) {
    lines.push(`- **Cursor chat id:** \`${r.cursorChatId}\``);
    lines.push(`  Resume: \`cursor-agent --resume=${r.cursorChatId}\``);
  }
  if (r.cloud) lines.push('- **Cloud:** yes');
  if (r.background) lines.push('- **Background:** yes');
  lines.push('');
  lines.push(`**Prompt:** ${r.prompt}`);
  if (r.filesTouched && r.filesTouched.length > 0) {
    lines.push('');
    lines.push('**Files touched:**');
    for (const f of r.filesTouched) lines.push(`- ${f}`);
  }
  if (r.summary) {
    lines.push('');
    lines.push('**Summary:**');
    lines.push('');
    lines.push(r.summary.trim());
  }
  lines.push('');
  lines.push(`**Raw log:** \`${r.rawLogPath}\``);
  return lines.join('\n') + '\n';
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { positional, flags } = parseCommandArgv(rawArgv, ['all']);
  const root = await repoRoot(process.cwd());
  const id = positional[0];
  if (id) {
    const job = readJob(root, id);
    if (!job) {
      process.stderr.write(jobNotFoundMessage(id));
      return 1;
    }
    process.stdout.write(renderDetail(job));
    return 0;
  }
  const limit = flags['all'] ? undefined : 10;
  const listOpts = {};
  if (typeof limit === 'number') listOpts.limit = limit;
  const rows = listJobs(root, listOpts);
  process.stdout.write(renderJobTable(rows));
  return 0;
}

import { invokedAsScript as __isScript } from './lib/invoked.mjs';
const invokedAsScript = __isScript(import.meta.url);

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`status failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
