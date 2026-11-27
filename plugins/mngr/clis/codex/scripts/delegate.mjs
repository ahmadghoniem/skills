#!/usr/bin/env node
// `/mngr:delegate codex`: codex's side of the shared delegate run
// (`scripts/lib/shared/delegate.mjs`).
import { installedVersion, listModels, runHeadless } from './lib/codex.mjs';
import { recordDetected } from './lib/papercuts.mjs';
import { quotaPath, releasePath } from './lib/paths.mjs';
import { isUnfinished, warnings } from './lib/render.mjs';
import { runDelegate } from '../../../scripts/lib/shared/delegate.mjs';
import { runAsScript } from '../../../scripts/lib/shared/proc.mjs';
import { fetchLatest } from './update.mjs';

/** The model of a fresh run with no `--model`: Codex's own "fast, go-to model". */
export const DEFAULT_MODEL = 'gpt-6.2-sol';

/** @type {import('../../../scripts/lib/shared/delegate.mjs').Adapter} */
export const adapter = {
  name: 'codex',
  usage: 'Usage: delegate.mjs [--model <id>] [--effort <level>] [--session <thread_id>] (--prompt-file <path> | <task...>)\n',
  options: { effort: { type: 'string' } },
  sessionFlag: 'session',
  // A continued session keeps its model unless one is named.
  model: (values, resume) => ({ model: values.model?.trim() || (resume ? undefined : DEFAULT_MODEL) }),
  listModels,
  // The effort is always passed, so a run never takes it from config.toml: the
  // one named, or the model's own default.
  effort: (values, info) => {
    const effort = values.effort?.trim();
    if (!info) return { effort: effort || undefined };
    if (!effort) return { effort: info.defaultEffort };
    if (info.efforts.includes(effort)) return { effort };
    return { error: `${info.id} takes --effort ${info.efforts.join(', ')} (its default: ${info.defaultEffort}); got \`${effort}\`.` };
  },
  run: (ctx, onSession) => runHeadless({ prompt: ctx.prompt, model: ctx.model, effort: ctx.effort, sessionId: ctx.session, cwd: ctx.cwd, onSession }),
  warnings,
  isUnfinished,
  record: (warns, run, ctx) =>
    recordDetected(warns, { toolVersion: ctx.toolVersion, model: ctx.model, sessionId: run.sessionId, exitCode: run.exitCode, notes: run.notes }),
  paths: { quota: quotaPath, release: releasePath },
  installedVersion,
  fetchLatest,
};

/** @param {string[]} argv */
export const main = (argv) => runDelegate(adapter, argv);

runAsScript(import.meta.url, main);
