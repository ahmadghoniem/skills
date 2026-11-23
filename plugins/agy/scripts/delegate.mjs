#!/usr/bin/env node
// Runs one agy task and prints its report. Claude starts it in a background
// Bash call: Claude Code reports when it ends, keeps the output, and TaskStop
// ends it, so the plugin keeps no job records of its own.
import { existsSync } from 'node:fs';
import {
  MAX_STDIN_BYTES,
  bashServerEntry,
  buildArgs,
  installPlugin,
  installedVersion,
  listModels,
  resolveBin,
  runHeadless,
  stdinLine,
  taskMessage,
} from './lib/agy.mjs';
import { repoRoot, shortHistory } from './lib/git.mjs';
import { recordDetected } from './lib/papercuts.mjs';
import { summariseEvents } from './lib/parse.mjs';
import { releasePath } from './lib/paths.mjs';
import { anomalies, isUnfinished, renderResult } from './lib/render.mjs';
import { parseCli, readPromptFile, runAsScript } from './lib/shared/proc.mjs';
import { latestRelease, noticeOnce } from './lib/shared/release.mjs';
import { fetchLatest } from './update.mjs';

/** The model of a fresh run with no `--model`. Its id carries the effort level. */
const DEFAULT_MODEL = 'gemini-4-hydrogen-medium';

/** The agy agent every fresh run uses. */
const AGENT = 'bash-delegate';

const USAGE =
  'Usage: delegate.mjs [--model <id>] [--sandbox] [--conversation <uuid>] (--prompt-file <path> | <task...>)\n';

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
      conversation: { type: 'string' },
      sandbox: { type: 'boolean' },
      effort: { type: 'string' },
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
  if (values.effort !== undefined) {
    process.stderr.write('Error: --effort is not an option. Pass a full model id, which carries the level: --model gemini-4-hydrogen-high.\n');
    return 2;
  }
  const conversation = values.conversation?.trim() || undefined;
  const inline = positionals.join(' ').trim();
  if (inline && values['prompt-file']) {
    process.stderr.write('Error: pass the task inline or with --prompt-file, not both.\n');
    return 2;
  }
  let task = inline;
  if (values['prompt-file']) {
    try {
      task = readPromptFile(values['prompt-file']);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      return 2;
    }
  }
  if (!task) {
    if (!conversation) {
      process.stderr.write(`Error: no task given.\n${USAGE}`);
      return 2;
    }
    task = 'Continue from where you left off.';
  }

  const root = await repoRoot(process.cwd());
  // A resumed conversation keeps its model and agent.
  const model = values.model?.trim() || (conversation ? undefined : DEFAULT_MODEL);
  const isGit = existsSync(`${root}/.git`);
  const message = conversation
    ? task
    : taskMessage({ workspace: root, isGit, history: isGit ? await shortHistory(root) : undefined, task });
  const bytes = Buffer.byteLength(message, 'utf8');
  if (bytes > MAX_STDIN_BYTES) {
    process.stderr.write(`Error: the message is ${bytes} bytes, over the ${MAX_STDIN_BYTES} agy reads from stdin: shorten the brief or split the task.\n`);
    return 2;
  }

  // The agent and its bash tool come from agy's plugin, loaded on every start.
  // The agent relies on the tool for every search and edit, so a run without it stops here.
  try {
    await installPlugin(await resolveBin());
  } catch (err) {
    process.stderr.write(`Error: bash tool not installed, so agy was not started: ${err.message}\n`);
    return 1;
  }
  if (!existsSync(bashServerEntry().args[0])) {
    process.stderr.write(`Error: bash tool not installed, so agy was not started: ${bashServerEntry().args[0]} is missing\n`);
    return 1;
  }

  // Both run alongside agy; the release check reaches GitHub at most once a day.
  const release = latestRelease(releasePath(), fetchLatest).catch(() => null);
  const version = installedVersion();

  const args = buildArgs({
    addDir: conversation ? undefined : root,
    model,
    agent: conversation ? undefined : AGENT,
    sandbox: values.sandbox,
    conversationId: conversation,
  });
  const result = await runHeadless({ args, input: stdinLine(message), cwd: root });
  const summary = summariseEvents(result.events);

  const run = {
    agyStatus: summary.status,
    exitCode: result.exitCode,
    error: summary.error,
    response: summary.response,
    conversationId: summary.conversationId ?? conversation,
    finishedReason: summary.finishedReason,
    stderr: result.stderr,
  };
  // agy names display labels on a rejected model, which `--model` does not
  // accept; list the ids instead.
  if (/invalid model selection/i.test(String(run.error ?? '')) && /not recognized/i.test(String(run.error))) {
    run.validModels = await listModels().then((ms) => ms.map((m) => m.id)).catch(() => undefined);
  }

  const warns = anomalies(run);
  recordDetected(warns, {
    toolErrors: summary.toolErrors,
    toolVersion: (await version) ?? undefined,
    model: summary.model ?? model,
    conversationId: run.conversationId,
    toolCalls: summary.toolCalls,
    agyStatus: summary.status,
    exitCode: result.exitCode,
  });
  process.stdout.write(renderResult(run));
  process.stdout.write(
    noticeOnce({ path: releasePath(), tool: 'agy', command: '/agy:update', release: await release, installed: await version }),
  );
  return isUnfinished(run) ? 1 : 0;
}

runAsScript(import.meta.url, main);
