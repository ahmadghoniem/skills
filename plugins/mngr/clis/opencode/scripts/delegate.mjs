#!/usr/bin/env node
// `/mngr:delegate opencode`: opencode's side of the shared delegate run
// (`scripts/lib/shared/delegate.mjs`).
import { installedVersion, listModels, newSessionId, runHeadless } from './lib/opencode.mjs';
import { recordDetected } from './lib/papercuts.mjs';
import { modelsPath, quotaPath, releasePath } from './lib/paths.mjs';
import { isUnfinished, warnings } from './lib/render.mjs';
import { runDelegate } from '../../../scripts/lib/shared/delegate.mjs';
import { runAsScript } from '../../../scripts/lib/shared/proc.mjs';
import { fetchLatest } from './update.mjs';

/** @type {import('../../../scripts/lib/shared/delegate.mjs').Adapter} */
export const adapter = {
  name: 'opencode',
  usage: 'Usage: delegate.mjs --model <provider/model[#variant]> [--session <ses_id>] (--prompt-file <path> | <task...>)\n',
  sessionFlag: 'session',
  checkSession: (id) => (id.startsWith('ses') ? undefined : 'an opencode session id starts with `ses`.'),
  // opencode runs on API keys, which bill per token, so mngr picks no model for
  // it: a run without `--model` is refused rather than left to opencode, which
  // would pick one of its configured models on its own.
  model: (values) => {
    const model = values.model?.trim();
    return model ? { model } : { error: 'name a model with --model: opencode runs on API keys, so mngr picks none. `opencode models` lists them.' };
  },
  baseModel: (model) => model.split('#')[0],
  listModels,
  get modelsCache() {
    return modelsPath();
  },
  newSession: newSessionId,
  run: (ctx) => runHeadless({ prompt: ctx.prompt, model: ctx.model, sessionId: ctx.sessionId }),
  warnings,
  isUnfinished,
  record: (warns, run, ctx) =>
    recordDetected(warns, { toolErrors: run.toolErrors, toolVersion: ctx.toolVersion, model: ctx.model, sessionId: run.sessionId, exitCode: run.exitCode }),
  paths: { quota: quotaPath, release: releasePath },
  installedVersion,
  fetchLatest,
};

/** @param {string[]} argv */
export const main = (argv) => runDelegate(adapter, argv);

runAsScript(import.meta.url, main);
