#!/usr/bin/env node
// `/mngr:delegate agy`: agy's side of the shared delegate run
// (`scripts/lib/shared/delegate.mjs`).
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
import { conversationOf, summariseEvents } from './lib/parse.mjs';
import { modelsPath, quotaPath, releasePath } from './lib/paths.mjs';
import { anomalies, isUnfinished } from './lib/render.mjs';
import { runDelegate } from '../../../scripts/lib/shared/delegate.mjs';
import { runAsScript } from '../../../scripts/lib/shared/proc.mjs';
import { fetchLatest } from './update.mjs';

/** The model of a fresh run with no `--model`. Its id carries the effort level. */
const DEFAULT_MODEL = 'gemini-4-hydrogen-medium';

/** The agy agent every fresh run uses. */
const AGENT = 'bash-delegate';

/** @type {import('../../../scripts/lib/shared/delegate.mjs').Adapter} */
export const adapter = {
  name: 'agy',
  usage: 'Usage: delegate.mjs [--model <id>] [--conversation <uuid>] (--prompt-file <path> | <task...>)\n',
  options: { effort: { type: 'string' } },
  sessionFlag: 'conversation',
  checkArgs: (values) =>
    values.effort === undefined ? undefined : '--effort is not an option. Pass a full model id, which carries the level: --model gemini-4-hydrogen-high.',
  // A continued conversation keeps its model and agent.
  model: (values, resume) => ({ model: values.model?.trim() || (resume ? undefined : DEFAULT_MODEL) }),
  listModels,
  get modelsCache() {
    return modelsPath();
  },

  async prepare(ctx) {
    ctx.root = await repoRoot(ctx.cwd);
    const isGit = existsSync(`${ctx.root}/.git`);
    ctx.message = ctx.session
      ? ctx.prompt
      : taskMessage({ workspace: ctx.root, isGit, history: isGit ? await shortHistory(ctx.root) : undefined, task: ctx.prompt });
    const bytes = Buffer.byteLength(ctx.message, 'utf8');
    if (bytes > MAX_STDIN_BYTES) {
      return { code: 2, message: `the message is ${bytes} bytes, over the ${MAX_STDIN_BYTES} agy reads from stdin: shorten the brief or split the task.` };
    }
    // The agent and its bash tool come from agy's plugin, loaded on every start.
    // The agent relies on the tool for every search and edit, so a run without it stops here.
    try {
      await installPlugin(await resolveBin());
    } catch (err) {
      return `bash tool not installed, so agy was not started: ${err.message}`;
    }
    const entry = bashServerEntry().args[0];
    if (!existsSync(entry)) return `bash tool not installed, so agy was not started: ${entry} is missing`;
    return undefined;
  },

  async run(ctx, onSession) {
    const args = buildArgs({
      addDir: ctx.session ? undefined : ctx.root,
      model: ctx.model,
      agent: ctx.session ? undefined : AGENT,
      conversationId: ctx.session,
    });
    // agy names the conversation in its first events, so the id is printed as soon as it appears.
    const result = await runHeadless({ args, input: stdinLine(ctx.message), cwd: ctx.root, onEvent: (ev) => onSession(conversationOf(ev)) });
    const summary = summariseEvents(result.events);
    return {
      agyStatus: summary.status,
      exitCode: result.exitCode,
      error: summary.error,
      text: summary.response,
      sessionId: summary.conversationId ?? ctx.session,
      finishedReason: summary.finishedReason,
      stderr: result.stderr,
      summary,
    };
  },

  failureText: (run) => [run.error, ...(run.stderr ?? [])].filter(Boolean).join('\n'),
  warnings: anomalies,
  isUnfinished,
  record: (warns, run, ctx) =>
    recordDetected(warns, {
      toolErrors: run.summary?.toolErrors,
      toolVersion: ctx.toolVersion,
      model: run.summary?.model ?? ctx.model,
      conversationId: run.sessionId,
      toolCalls: run.summary?.toolCalls,
      agyStatus: run.agyStatus,
      exitCode: run.exitCode,
    }),
  paths: { quota: quotaPath, release: releasePath },
  installedVersion,
  fetchLatest,
};

/** @param {string[]} argv */
export const main = (argv) => runDelegate(adapter, argv);

runAsScript(import.meta.url, main);
