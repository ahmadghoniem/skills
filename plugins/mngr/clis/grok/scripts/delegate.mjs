#!/usr/bin/env node
// `/mngr:delegate grok`: grok's side of the shared delegate run
// (`scripts/lib/shared/delegate.mjs`).
import { randomUUID } from 'node:crypto';
import { DEFAULT_EFFORT, EFFORTS, installedVersion, listModels, runHeadless } from './lib/grok.mjs';
import { recordDetected } from './lib/papercuts.mjs';
import { quotaPath, releasePath } from './lib/paths.mjs';
import { isUnfinished, warnings } from './lib/render.mjs';
import { runDelegate } from '../../../scripts/lib/shared/delegate.mjs';
import { runAsScript } from '../../../scripts/lib/shared/proc.mjs';
import { fetchLatest } from './update.mjs';

/** @type {import('../../../scripts/lib/shared/delegate.mjs').Adapter} */
export const adapter = {
  name: 'grok',
  usage: `Usage: delegate.mjs [--model <id>] [--effort ${EFFORTS.join('|')}] [--session <uuid>] (--prompt-file <path> | <task...>)\n`,
  options: { effort: { type: 'string', default: DEFAULT_EFFORT } },
  sessionFlag: 'session',
  model: (values) => ({ model: values.model?.trim() || undefined }),
  listModels,
  effort: (values) =>
    EFFORTS.includes(values.effort)
      ? { effort: values.effort }
      : { error: `--effort must be ${EFFORTS.join(' or ')} (your xAI plan allows no more); got \`${values.effort}\`.` },
  newSession: randomUUID,
  run: (ctx) => runHeadless({ prompt: ctx.prompt, model: ctx.model, effort: ctx.effort, sessionId: ctx.sessionId, resume: Boolean(ctx.session) }),
  warnings,
  isUnfinished,
  record: (warns, run, ctx) =>
    recordDetected(warns, { toolVersion: ctx.toolVersion, model: ctx.model, sessionId: run.sessionId, turns: run.turns, exitCode: run.exitCode, stopReason: run.stopReason }),
  paths: { quota: quotaPath, release: releasePath },
  installedVersion,
  fetchLatest,
};

/** @param {string[]} argv */
export const main = (argv) => runDelegate(adapter, argv);

runAsScript(import.meta.url, main);
