#!/usr/bin/env node
// Runs one opencode task and prints its write-up. Claude starts it in a
// background Bash call: Claude Code reports when it ends, keeps the output, and
// TaskStop ends it, so the plugin keeps no job records of its own.
import { installedVersion, runHeadless } from './lib/opencode.mjs';
import { recordDetected } from './lib/papercuts.mjs';
import { releasePath } from './lib/paths.mjs';
import { isUnfinished, renderResult, warnings } from './lib/render.mjs';
import { parseCli, readPromptFile, runAsScript } from './lib/shared/proc.mjs';
import { latestRelease, noticeOnce } from './lib/shared/release.mjs';
import { fetchLatest } from './update.mjs';

/**
 * Always passed: with no `--model`, opencode picks one of its configured models
 * on its own, which may be metered.
 */
export const DEFAULT_MODEL = 'nebius/deepseek-ai/DeepSeek-V4.1-Flash-1017';

const USAGE = 'Usage: delegate.mjs [--model <provider/model[#variant]>] [--session <ses_id>] (--prompt-file <path> | <task...>)\n';

/** @param {string[]} argv */
export async function main(argv) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseCli(argv, {
      'prompt-file': { type: 'string' },
      model: { type: 'string' },
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
  const model = values.model?.trim() || DEFAULT_MODEL;
  const session = values.session?.trim() || undefined;
  if (session && !session.startsWith('ses')) {
    process.stderr.write('Error: an opencode session id starts with `ses`.\n');
    return 2;
  }
  const inline = positionals.join(' ').trim();
  if (inline && values['prompt-file']) {
    process.stderr.write('Error: pass the task inline or with --prompt-file, not both.\n');
    return 2;
  }
  if (values['prompt-file']) {
    try {
      readPromptFile(values['prompt-file']);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      return 2;
    }
  }
  let prompt = inline;
  if (!prompt && !values['prompt-file']) {
    if (!session) {
      process.stderr.write(`Error: no task given.\n${USAGE}`);
      return 2;
    }
    prompt = 'Continue from where you left off.';
  }

  const release = latestRelease(releasePath(), fetchLatest).catch(() => null);
  const version = installedVersion();
  const run = await runHeadless({ prompt, promptFile: values['prompt-file'], model, session });

  recordDetected(warnings(run), {
    toolErrors: run.toolErrors,
    toolVersion: (await version) ?? undefined,
    model,
    sessionId: run.sessionId,
    exitCode: run.exitCode,
  });
  process.stdout.write(renderResult(run));
  process.stdout.write(
    noticeOnce({ path: releasePath(), tool: 'opencode', command: '/opencode:update', release: await release, installed: await version }),
  );
  return isUnfinished(run) ? 1 : 0;
}

runAsScript(import.meta.url, main);
