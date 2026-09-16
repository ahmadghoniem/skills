#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  DEFAULT_PRINT_TIMEOUT_SEC,
  WATCHDOG_GRACE_SEC,
  buildArgs,
  cachedToolVersion,
  modelEncodesEffort,
  resolveDefaultModel,
  runHeadless,
} from './lib/agy.mjs';
import { invokedAsScript, parseCommandArgv, parseTimeout } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import {
  agyLogPath,
  createJob,
  promptPath,
  pruneOlderThanDays,
  rawLogPath as rawLogPathFor,
  readJob,
  uniqueJobName,
  updateJob,
} from './lib/jobs.mjs';
import { pluginVersion, recordDetected } from './lib/papercuts.mjs';
import { summariseEvents } from './lib/parse.mjs';
import { anomalies, isUnfinished, renderResult } from './lib/render.mjs';

// Runs in the foreground of its child process; the orchestrator invokes it
// under a backgrounded bash call to receive exit notifications without
// detaching. agy models encode effort (e.g. `gemini-3.7-flash-low`); medium is
// default unless overridden by `--effort`.
const DEFAULT_EFFORT = 'medium';

const BOOLEAN_FLAGS = ['sandbox', 'help', 'continue'];
const USAGE =
  'Usage: /agy:delegate [--model <id>] [--effort <level>] [--timeout <sec>] [--sandbox] [--conversation <uuid>] [--continue] <task...>\n';

function parseFlags(argv) {
  const { positional, flags } = parseCommandArgv(argv, BOOLEAN_FLAGS);
  const conversation =
    typeof flags['conversation'] === 'string' && flags['conversation'].trim()
      ? String(flags['conversation']).trim()
      : undefined;
  const continueLatest = flags['continue'] === true;
  return {
    positional,
    model: typeof flags['model'] === 'string' ? flags['model'] : undefined,
    effort: typeof flags['effort'] === 'string' ? flags['effort'] : undefined,
    timeout: parseTimeout(flags['timeout'], DEFAULT_PRINT_TIMEOUT_SEC),
    sandbox: flags['sandbox'] === true,
    help: flags['help'] === true,
    conversation,
    continueLatest,
  };
}

function isResume(flags) {
  return Boolean(flags.conversation || flags.continueLatest);
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

  const effort =
    flags.effort && !modelEncodesEffort(flags.model) ? flags.effort : undefined;

  updateJob(root, jobId, {
    pid: process.pid,
    model: flags.model ?? '',
    effort,
    promptPath: absPrompt,
    sandbox: flags.sandbox || undefined,
  });

  const args = buildArgs({
    addDir: isResume(flags) ? undefined : root,
    promptPath: absPrompt,
    printTimeoutSec: flags.timeout,
    logFile: agyLogPath(root, jobId),
    model: flags.model,
    effort,
    sandbox: flags.sandbox,
    conversationId: flags.conversation,
    continueLatest: flags.continueLatest && !flags.conversation,
  });

  const result = await runHeadless({
    args,
    cwd: root,
    timeoutSec: flags.timeout + WATCHDOG_GRACE_SEC,
    logPath: rawLogPathFor(root, jobId),
    onSpawn: (cliPid) => {
      try {
        updateJob(root, jobId, { cliPid });
      } catch {
        // A failed pid write must not tear down a running agy.
      }
    },
    onEvent: (ev) => {
      if (ev.event === 'init' && typeof ev.conversation_id === 'string') {
        try {
          updateJob(root, jobId, { conversationId: ev.conversation_id });
        } catch {
          // noop
        }
      }
    },
  });

  const summary = summariseEvents(result.events);

  // agy 1.1.28+ stops itself at the print timeout and returns partial output
  // with status SUCCESS and exit 0 — the only trace is this stderr line.
  const timeoutLine = (result.stderr ?? []).find((l) =>
    /^\[agy\] print timeout after \S+ with turn in progress/.test(l),
  );
  const timedOut = Boolean(timeoutLine);
  const timedOutAfter = timeoutLine ? /after (\S+)/.exec(timeoutLine)[1] : undefined;

  // Mark failed if killed, if agy exited non-zero without emitting a result
  // event (spawn failure), or if agy did no work at all (status ERROR with no
  // conversation id — an unknown model, a rejected flag). Native exit code and
  // agy status can otherwise disagree on completed runs.
  const neverStarted =
    (summary.status == null && result.exitCode !== 0) ||
    (String(summary.status).toUpperCase() === 'ERROR' && !summary.conversationId);
  const pluginStatus = result.killed || neverStarted ? 'failed' : 'done';
  updateJob(root, jobId, {
    status: pluginStatus,
    exitCode: result.exitCode,
    finishedAt: new Date().toISOString(),
    summary: summary.response,
    error: summary.error,
    agyStatus: summary.status,
    durationSeconds: summary.durationSeconds,
    conversationId: summary.conversationId,
    model: summary.model ?? flags.model ?? '',
    killed: result.killed || undefined,
    timedOut: timedOut || undefined,
    timedOutAfter,
    // Persisted so `/agy:result <id>` matches foreground output; omitted when
    // empty.
    stderrTail: result.stderr?.length ? result.stderr : undefined,
    toolErrors: summary.toolErrors?.length ? summary.toolErrors : undefined,
    compactions: summary.compactions || undefined,
    deniedActions: summary.deniedActions?.length ? summary.deniedActions : undefined,
  });

  // Sole write site for detected papercuts. `/agy:result` evaluates anomalies
  // dynamically on read without writing duplicate entries.
  const finalJob = readJob(root, jobId);
  if (finalJob) {
    recordDetected(anomalies(finalJob), {
      toolVersion: cachedToolVersion() ?? undefined,
      pluginVersion,
      model: summary.model ?? flags.model ?? undefined,
      repo: root,
      jobId,
      conversationId: summary.conversationId,
      toolCalls: summary.toolCalls,
      agyStatus: summary.status,
      exitCode: result.exitCode,
      toolErrors: summary.toolErrors,
      stderrTail: result.stderr,
    });
  }
}

/**
 * Run `runAndRecord`, updating the job record to failed if an error throws
 * before completion (such as binary resolution failure), then rethrow.
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

  const prompt = flags.positional.join(' ').trim();
  if (!prompt && !isResume(flags)) {
    process.stderr.write('Error: no task description provided.\n');
    process.stderr.write(USAGE);
    return 2;
  }

  const root = await repoRoot(process.cwd());
  pruneOlderThanDays(root, 30);

  // Resolve default model from cache. Omitted on resume because
  // `--conversation` preserves the initial model (e.g. pro), avoiding
  // unintended downgrades.
  if (!flags.model && !isResume(flags)) {
    flags.model = resolveDefaultModel(flags.effort ?? DEFAULT_EFFORT) ?? undefined;
  }

  const jobId = uniqueJobName(root, prompt || 'continue');
  const task = prompt || 'Continue from where you left off.';

  createJob({ id: jobId, repoPath: root, prompt: task, model: flags.model ?? '' });
  process.stdout.write(`agy \`${jobId}\`\n\n`);

  await runOrMarkFailed(flags, task, jobId, root);
  const finished = readJob(root, jobId);
  if (finished) process.stdout.write(renderResult(finished));
  return finished && isUnfinished(finished) ? 1 : 0;
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
