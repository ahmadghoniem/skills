#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { invokedAsScript, parseCommandArgv, parseTimeout } from './lib/args.mjs';
import { resolveModel } from './lib/config.mjs';
import { repoRoot } from './lib/git.mjs';
import {
  createJob,
  promptPath,
  pruneOlderThanDays,
  rawLogPath as rawLogPathFor,
  readJob,
  uniqueJobName,
  updateJob,
} from './lib/jobs.mjs';
import {
  DEFAULT_TIMEOUT_SEC,
  buildArgs,
  cachedModels,
  modelCacheStale,
  refreshModelCache,
  runHeadless,
} from './lib/opencode.mjs';
import { summariseEvents } from './lib/parse.mjs';
import { isUnfinished, renderResult } from './lib/render.mjs';

// Runs in the foreground of its child process; the orchestrator invokes it
// under a backgrounded bash call to receive exit notifications without
// detaching.

const BOOLEAN_FLAGS = ['help', 'continue', 'fork'];
const USAGE =
  'Usage: /opencode:delegate [--model <id>] [--variant <level>] [--timeout <sec>] [--dir <path>] [--session <id>] [--continue] [--fork] <task... | --prompt-file <path>>\n';

/** Session ids look like `ses_f44f661a1ffemVReM1MqGamB9x`. */
const SESSION_RE = /^ses_[A-Za-z0-9]+$/;

/**
 * Read the brief from `--prompt-file <path>` so a long or quote-heavy brief
 * reaches opencode without going through the command line. Claude writes the
 * file with its Write tool; this only reads it back.
 *
 * @param {unknown} spec
 * @returns {string}
 */
function readPromptFile(spec) {
  if (spec === true || spec === '') {
    throw new Error('--prompt-file needs a path.');
  }
  const path = String(spec);
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `could not read --prompt-file ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const text = raw.trim();
  if (text.length === 0) {
    throw new Error(`prompt file is empty: ${path}`);
  }
  return text;
}

function parseFlags(argv) {
  const { positional, flags } = parseCommandArgv(argv, BOOLEAN_FLAGS);
  const session =
    typeof flags['session'] === 'string' && flags['session'].trim()
      ? String(flags['session']).trim()
      : undefined;
  return {
    positional,
    model: typeof flags['model'] === 'string' ? flags['model'] : undefined,
    variant: typeof flags['variant'] === 'string' ? flags['variant'] : undefined,
    timeout: parseTimeout(flags['timeout'], DEFAULT_TIMEOUT_SEC),
    dir: typeof flags['dir'] === 'string' ? flags['dir'] : undefined,
    help: flags['help'] === true,
    session,
    continueLatest: flags['continue'] === true,
    fork: flags['fork'] === true,
    // `undefined` = flag absent; `true` = bare `--prompt-file` with no value
    // (a usage error, caught in main); otherwise the path as given.
    promptFile: flags['prompt-file'],
  };
}

function isResume(flags) {
  return Boolean(flags.session || flags.continueLatest);
}

/**
 * Whether `model` is in the cached live list.
 *
 * @param {string|undefined} model
 * @param {import('./lib/opencode.mjs').ModelInfo[]|null} models
 * @returns {boolean}
 */
function isModelCached(model, models) {
  if (!model || !Array.isArray(models)) return false;
  return models.some((m) => m.id === model);
}

/**
 * A session title short enough to read in `opencode session list`.
 *
 * @param {string} text
 * @returns {string}
 */
function titleFor(text) {
  const oneLine = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

/**
 * @param {ReturnType<typeof parseFlags>} flags
 * @param {string} prompt
 * @param {string} jobId
 * @param {string} root
 */
async function runAndRecord(flags, prompt, jobId, root) {
  const absPrompt = resolvePath(promptPath(root, jobId));
  writeFileSync(absPrompt, prompt, 'utf8');

  const workDir = flags.dir ? resolvePath(flags.dir) : root;

  updateJob(root, jobId, {
    pid: process.pid,
    model: flags.model ?? '',
    variant: flags.variant,
    promptPath: absPrompt,
    workDir,
    briefPath: typeof flags.promptFile === 'string' ? flags.promptFile : undefined,
  });

  const args = buildArgs({
    promptPath: absPrompt,
    model: flags.model,
    variant: flags.variant,
    dir: workDir,
    title: titleFor(prompt),
    sessionId: flags.session,
    continueLatest: flags.continueLatest && !flags.session,
    fork: flags.fork,
  });

  const result = await runHeadless({
    args,
    cwd: workDir,
    timeoutSec: flags.timeout,
    logPath: rawLogPathFor(root, jobId),
    onSpawn: (cliPid) => {
      try {
        updateJob(root, jobId, { cliPid });
      } catch {
        // A failed pid write must not tear down a running opencode.
      }
    },
    onEvent: (ev) => {
      // The session id arrives on the very first event; persist it straight
      // away so a run killed mid-flight is still resumable.
      if (typeof ev.sessionID === 'string') {
        try {
          updateJob(root, jobId, { sessionId: ev.sessionID });
        } catch {
          // noop
        }
      }
    },
  });

  const summary = summariseEvents(result.events);

  // Failed means: the watchdog killed it, opencode exited non-zero without
  // ever opening a session (a bad flag, an unknown model), or it opened one
  // and never completed a step (a provider error on the first request — the
  // session exists, so the no-session test alone would call that a success).
  // A run that opened a session and did work is `done` even when the finish
  // reason is unhappy — the ⚠ lines carry that, not the status.
  const neverStarted = !summary.sessionId && result.exitCode !== 0;
  const neverFinished = Boolean(summary.sessionId) && summary.finishReason == null;
  const pluginStatus = result.killed || neverStarted || neverFinished ? 'failed' : 'done';

  updateJob(root, jobId, {
    status: pluginStatus,
    exitCode: result.exitCode,
    finishedAt: new Date().toISOString(),
    summary: summary.response,
    error: summary.error,
    finishReason: summary.finishReason,
    durationSeconds: summary.durationSeconds,
    sessionId: summary.sessionId,
    model: flags.model ?? '',
    costUsd: summary.costUsd || undefined,
    tokens: summary.tokens,
    steps: summary.steps || undefined,
    toolCalls: summary.toolCalls || undefined,
    killed: result.killed || undefined,
    // Persisted so `/opencode:result <id>` matches foreground output; omitted
    // when empty.
    stderrTail: result.stderr?.length ? result.stderr : undefined,
    toolErrors: summary.toolErrors?.length ? summary.toolErrors : undefined,
  });
}

/**
 * Run `runAndRecord`, marking the job failed if something throws before
 * completion (such as binary resolution), then rethrow.
 *
 * @param {ReturnType<typeof parseFlags>} flags
 * @param {string} prompt
 * @param {string} jobId
 * @param {string} root
 */
async function runOrMarkFailed(flags, prompt, jobId, root) {
  try {
    await runAndRecord(flags, prompt, jobId, root);
  } catch (err) {
    updateJob(root, jobId, {
      status: 'failed',
      exitCode: 1,
      finishedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const flags = parseFlags(rawArgv);

  if (flags.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (flags.session && !SESSION_RE.test(flags.session)) {
    process.stderr.write(
      `Error: --session expects an opencode session id like ses_abc123, got '${flags.session}'.\n`,
    );
    return 2;
  }

  let prompt = flags.positional.join(' ').trim();
  if (flags.promptFile !== undefined) {
    if (prompt.length > 0) {
      process.stderr.write(
        'Error: pass the task either on the command line or via --prompt-file, not both.\n',
      );
      return 2;
    }
    try {
      prompt = readPromptFile(flags.promptFile);
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
  }
  if (!prompt && !isResume(flags)) {
    process.stderr.write('Error: no task description provided.\n');
    process.stderr.write(USAGE);
    return 2;
  }

  // The allowlist gate. `opencode run` answers a missing --model by choosing
  // one itself, so there is no safe "let the CLI decide" path here.
  const resolution = resolveModel(flags.model);
  if (!resolution.model) {
    process.stderr.write(`Error: ${resolution.error}\n`);
    return 2;
  }
  flags.model = resolution.model;

  const root = await repoRoot(process.cwd());
  pruneOlderThanDays(root, 30);

  // A model allowed today must not be rejected by a week-old cache; refresh
  // once, before the run, when it is not cached yet.
  if (!isModelCached(flags.model, cachedModels())) {
    await refreshModelCache().catch(() => {});
  }

  const jobId = uniqueJobName(root, prompt || 'continue');
  const task = prompt || 'Continue from where you left off.';

  createJob({ id: jobId, repoPath: root, prompt: task, model: flags.model });
  process.stdout.write(`opencode \`${jobId}\`  ·  ${flags.model}\n\n`);

  await runOrMarkFailed(flags, task, jobId, root);
  const finished = readJob(root, jobId);

  if (finished) process.stdout.write(renderResult(finished));
  const code = finished && isUnfinished(finished) ? 1 : 0;

  // Weekly refresh, after the output above is written and before returning —
  // never a detached process. Swallowed so a failed refresh cannot change the
  // exit code.
  if (modelCacheStale()) {
    await refreshModelCache().catch(() => {});
  }

  return code;
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `delegate failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(1);
    });
}
