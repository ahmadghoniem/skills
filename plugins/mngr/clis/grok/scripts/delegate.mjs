#!/usr/bin/env node
// Runs one grok task and prints its write-up. Claude starts it in a background
// Bash call: Claude Code reports when it ends, keeps the output, and TaskStop
// ends it, so the plugin keeps no job records of its own.
import { DEFAULT_EFFORT, EFFORTS, installedVersion, runHeadless } from './lib/grok.mjs';
import { recordDetected } from './lib/papercuts.mjs';
import { quotaPath, releasePath } from './lib/paths.mjs';
import { blockedMessage, noteRun, quotaBlock } from '../../../scripts/lib/shared/quota.mjs';
import { isUnfinished, renderResult, warnings } from './lib/render.mjs';
import { parseCli, readPromptFile, runAsScript } from '../../../scripts/lib/shared/proc.mjs';
import { latestRelease, noticeOnce } from '../../../scripts/lib/shared/release.mjs';
import { fetchLatest } from './update.mjs';

const USAGE =
  'Usage: delegate.mjs [--model <id>] [--effort low|medium] [--session <uuid>] (--prompt-file <path> | <task...>)\n';

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseCli(argv, {
      'prompt-file': { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string', default: DEFAULT_EFFORT },
      session: { type: 'string' },
      help: { type: 'boolean' },
    }));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!EFFORTS.includes(values.effort)) {
    process.stderr.write(`Error: --effort must be ${EFFORTS.join(' or ')}; got \`${values.effort}\`.\n`);
    return 2;
  }

  const inline = positionals.join(' ').trim();
  if (inline && values['prompt-file']) {
    process.stderr.write('Error: pass the task inline or with --prompt-file, not both.\n');
    return 2;
  }
  let prompt = inline;
  if (values['prompt-file']) {
    try {
      readPromptFile(values['prompt-file']);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      return 2;
    }
  } else if (!prompt) {
    if (!values.session) {
      process.stderr.write(`Error: no task given.\n${USAGE}`);
      return 2;
    }
    prompt = 'Continue from where you left off.';
  }

  const quotaKey = values.model?.trim() || 'default';
  const blocked = quotaBlock(quotaPath(), quotaKey);
  if (blocked) {
    process.stderr.write(blockedMessage('grok', quotaKey, blocked));
    return 1;
  }

  // Both run alongside grok; the release check reaches the network at most once a day.
  const release = latestRelease(releasePath(), fetchLatest).catch(() => null);
  const version = installedVersion();

  const run = await runHeadless({
    prompt,
    promptFile: values['prompt-file'],
    model: values.model?.trim() || undefined,
    effort: values.effort,
    session: values.session?.trim() || undefined,
  });

  noteRun(quotaPath(), quotaKey, isUnfinished(run) ? run.error ?? `exit ${run.exitCode}` : undefined);
  recordDetected(warnings(run), {
    toolVersion: (await version) ?? undefined,
    model: values.model,
    sessionId: run.sessionId,
    turns: run.turns,
    exitCode: run.exitCode,
    stopReason: run.stopReason,
  });
  process.stdout.write(renderResult(run));
  process.stdout.write(
    noticeOnce({ path: releasePath(), tool: 'grok', command: '/mngr:update grok', release: await release, installed: await version }),
  );
  return isUnfinished(run) ? 1 : 0;
}

runAsScript(import.meta.url, main);
