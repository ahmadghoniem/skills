// The delegate run every CLI shares: read the task, check the model, start the
// CLI, and print what came back. Each CLI's `delegate.mjs` passes an adapter
// that knows only its own CLI: its flags, how it takes model and effort, how to
// start it and how to read what it printed.
//
// Claude starts a run in a background Bash call: Claude Code reports when it
// ends, keeps the output, and TaskStop ends it with its process tree, so mngr
// keeps no job records and kills nothing itself.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseCli, readPromptFile } from './proc.mjs';
import { blockedMessage, noteRun, quotaBlock } from './quota.mjs';
import { latestRelease, noticeOnce } from './release.mjs';

/**
 * Added to every fresh brief. No CLI tells its model that nobody is there to
 * answer (grok aside), and a question written as the reply ends the run with
 * no work done.
 */
export const QUESTIONS_NOTE = [
  '---',
  'Nobody can answer questions during this run, so do not stop to ask one or wait for input; keep working.',
  'If a question blocks the task entirely, stop and say so.',
  'Put any question you would have asked under "Open questions" at the end of your report.',
].join('\n');

/** How long a model list read through the CLI is trusted. */
export const MODEL_LIST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} ModelInfo
 * @property {string} id
 * @property {string[]=} efforts      the levels `--effort` accepts, when the CLI takes it
 * @property {string=} defaultEffort  the provider's default level
 */

/**
 * @typedef {Object} Run
 * @property {number} exitCode
 * @property {string=} text
 * @property {string=} sessionId
 * @property {string=} error
 */

/**
 * @typedef {Object} Adapter
 * @property {string} name                        the CLI, as typed after /mngr:delegate
 * @property {string} usage
 * @property {Record<string, object>=} options    parseArgs options beyond prompt-file, model, help and the session flag
 * @property {'session'|'conversation'} sessionFlag
 * @property {(id: string) => string|undefined=} checkSession  an error for a malformed id
 * @property {(values: object) => string|undefined=} checkArgs  an error for a bad flag
 * @property {(values: object, resume: boolean) => {model?: string, error?: string}} model
 * @property {(model: string) => string=} baseModel  the id to look up in the model list (opencode drops `#variant`)
 * @property {() => Promise<ModelInfo[]>=} listModels
 * @property {string=} modelsCache               where a slow list is cached; without it the list is read each run
 * @property {(values: object, info?: ModelInfo) => {effort?: string, error?: string}=} effort
 * @property {() => string=} newSession          names the session before the run starts
 * @property {(ctx: object) => Promise<string|{message: string, code: number}|undefined>=} prepare  an error stops the run before the CLI starts (exit 1, or the code given)
 * @property {(ctx: object, onSession: (id: string) => void) => Promise<Run>} run
 * @property {(run: Run) => {id: string, line: string, detail?: string[]}[]} warnings
 * @property {(run: Run) => boolean} isUnfinished
 * @property {(warns: object[], run: Run, ctx: object) => void} record
 * @property {(run: Run) => string|undefined=} failureText  what a failed run said, for the quota record (default: its error)
 * @property {{quota: () => string, release: () => string}} paths
 * @property {() => Promise<string|null>} installedVersion
 * @property {() => Promise<object>} fetchLatest
 */

/** The model list, from the cache when it is fresh, unless `refresh`. Null when the CLI can't list. */
async function modelList(adapter, refresh) {
  const path = adapter.modelsCache;
  if (path && !refresh && existsSync(path)) {
    try {
      const cached = JSON.parse(readFileSync(path, 'utf8'));
      if (Date.now() - Date.parse(cached.fetchedAt) < MODEL_LIST_TTL_MS && cached.models?.length) return cached.models;
    } catch {
      // a damaged cache is read again from the CLI
    }
  }
  let models;
  try {
    models = await adapter.listModels();
  } catch {
    return null;
  }
  if (!models?.length) return null;
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ fetchedAt: new Date().toISOString(), models })}\n`, 'utf8');
  }
  return models;
}

/** Ids worth showing for a model the CLI doesn't have: those sharing its stem, else the first 20. */
export function closeMatches(id, ids) {
  for (let stem = id; stem.includes('-') || stem.includes('/'); ) {
    stem = stem.slice(0, Math.max(stem.lastIndexOf('-'), stem.lastIndexOf('/')));
    const hits = ids.filter((m) => m.startsWith(stem));
    if (hits.length) return hits.slice(0, 20);
  }
  return ids.slice(0, 20);
}

/**
 * Look the model up in the CLI's list. A miss reads the list again once, so a
 * model released today works at once. When the CLI can't list its models, the
 * run goes ahead and the CLI itself judges the id.
 *
 * @returns {Promise<{info?: ModelInfo, error?: string}>}
 */
async function checkModel(adapter, model) {
  if (!model || !adapter.listModels) return {};
  const id = adapter.baseModel ? adapter.baseModel(model) : model;
  let list = await modelList(adapter, false);
  if (list && !list.some((m) => m.id === id) && adapter.modelsCache) list = await modelList(adapter, true);
  if (!list) return {};
  const info = list.find((m) => m.id === id);
  if (info) return { info };
  const near = closeMatches(id, list.map((m) => m.id));
  return { error: `${adapter.name} has no model \`${id}\`. Close matches: ${near.join(', ')}.` };
}

/** The first line of a run: which model and session, as soon as the session is known. */
export const startLine = ({ model, cli, label, id, resume }) =>
  `model: ${model ?? (resume ? `kept from the ${label}` : `${cli}'s default`)} (${cli}) · ${label}: ${id}\n`;

/** @param {Adapter} adapter @param {Run} run @param {string} sessionLabel */
export function renderResult(adapter, run) {
  const warns = adapter.warnings(run);
  const lines = [];
  const text = String(run.text ?? '').replace(/\s+$/, '');
  if (text) lines.push(text);
  else if (!warns.length) lines.push(`(${adapter.name} returned no write-up)`);
  if (warns.length) {
    if (lines.length) lines.push('');
    for (const w of warns) {
      lines.push(`⚠ ${w.line}`);
      for (const d of w.detail ?? []) lines.push(`    ${d}`);
    }
  }
  if (run.sessionId) lines.push('', `${adapter.sessionFlag}: ${run.sessionId}`);
  return `${lines.join('\n')}\n`;
}

/**
 * One delegate run, start to finish. Exit codes: 0 done, 1 the run failed or
 * was refused for quota, 2 bad input (nothing started).
 *
 * @param {Adapter} adapter
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function runDelegate(adapter, argv) {
  const fail = (message, code = 2) => {
    process.stderr.write(`Error: ${message}\n${code === 2 ? adapter.usage : ''}`);
    return code;
  };
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseCli(argv, {
      'prompt-file': { type: 'string' },
      model: { type: 'string' },
      [adapter.sessionFlag]: { type: 'string' },
      help: { type: 'boolean' },
      ...adapter.options,
    }));
  } catch (err) {
    return fail(err.message);
  }
  if (values.help) {
    process.stdout.write(adapter.usage);
    return 0;
  }
  const argError = adapter.checkArgs?.(values);
  if (argError) return fail(argError);

  const session = values[adapter.sessionFlag]?.trim() || undefined;
  const sessionError = session && adapter.checkSession?.(session);
  if (sessionError) return fail(sessionError);

  const inline = positionals.join(' ').trim();
  if (inline && values['prompt-file']) return fail('pass the task inline or with --prompt-file, not both.');
  let task = inline;
  if (values['prompt-file']) {
    try {
      task = readPromptFile(values['prompt-file']);
    } catch (err) {
      return fail(err.message);
    }
  }
  if (!task && !session) return fail('no task given.');
  // A continued session already has the note from its first brief.
  const prompt = session ? task || 'Continue from where you left off.' : `${task}\n\n${QUESTIONS_NOTE}`;

  const picked = adapter.model(values, Boolean(session));
  if (picked.error) return fail(picked.error);
  const model = picked.model;
  const checked = await checkModel(adapter, model);
  if (checked.error) return fail(checked.error);
  const chosen = adapter.effort?.(values, checked.info) ?? {};
  if (chosen.error) return fail(chosen.error);

  const quotaKey = model ?? 'default';
  const blocked = quotaBlock(adapter.paths.quota(), quotaKey);
  if (blocked) {
    process.stderr.write(blockedMessage(adapter.name, quotaKey, blocked));
    return 1;
  }

  const ctx = { prompt, model, effort: chosen.effort, session, values, cwd: process.cwd() };
  const prepError = await adapter.prepare?.(ctx);
  if (prepError) return typeof prepError === 'string' ? fail(prepError, 1) : fail(prepError.message, prepError.code);

  // Both run alongside the CLI; the release check reaches the network at most once a day.
  const release = latestRelease(adapter.paths.release(), adapter.fetchLatest).catch(() => null);
  const version = adapter.installedVersion();

  let announced = false;
  const onSession = (id) => {
    if (announced || !id) return;
    announced = true;
    process.stdout.write(startLine({ model, cli: adapter.name, label: adapter.sessionFlag, id, resume: Boolean(session) }));
  };
  ctx.sessionId = session ?? adapter.newSession?.();
  if (ctx.sessionId) onSession(ctx.sessionId);

  const run = await adapter.run(ctx, onSession);
  const unfinished = adapter.isUnfinished(run);
  const said = adapter.failureText ? adapter.failureText(run) : run.error;
  noteRun(adapter.paths.quota(), quotaKey, unfinished ? said || `exit ${run.exitCode}` : undefined);
  try {
    adapter.record(adapter.warnings(run), run, { ...ctx, toolVersion: (await version) ?? undefined });
  } catch {
    // Logging must never fail a run.
  }
  process.stdout.write(renderResult(adapter, run));
  process.stdout.write(
    noticeOnce({ path: adapter.paths.release(), tool: adapter.name, command: `/mngr:update ${adapter.name}`, release: await release, installed: await version }),
  );
  return unfinished ? 1 : 0;
}
