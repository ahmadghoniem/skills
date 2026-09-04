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
import { collapseCommandArgv, invokedAsScript, parseArgv, parseTimeout } from './lib/args.mjs';
import { isDirty, isRepo, porcelain, porcelainDelta, repoRoot, snapshotFiles } from './lib/git.mjs';
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
import { anomalies, renderResult, viewFromJob } from './lib/render.mjs';

// Runs in the foreground of its child process; the orchestrator invokes it
// under a backgrounded bash call to receive exit notifications without
// detaching. agy models encode effort (e.g. `gemini-3.7-flash-low`); medium is
// default unless overridden by `--effort`.
const DEFAULT_EFFORT = 'medium';

const BOOLEAN_FLAGS = ['sandbox', 'help', 'continue'];
const USAGE =
  'Usage: /agy:delegate [--model <id>] [--effort <level>] [--timeout <sec>] [--sandbox] [--no-git-check] [--conversation <uuid>] [--continue] <task...>\n';

function parseFlags(argv) {
  const { positional, flags } = parseArgv(argv, BOOLEAN_FLAGS, { honorDoubleDash: false });
  const noGitCheck = flags['no-git-check'] === true || flags['git-check'] === false;
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
    noGitCheck,
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

  const git = await isRepo(root);
  /** @type {import('./lib/git.mjs').GitFile[]} */
  let before = [];
  if (git) {
    before = (await porcelain(root)) ?? [];
  }

  const effort =
    flags.effort && !modelEncodesEffort(flags.model) ? flags.effort : undefined;

  updateJob(root, jobId, {
    pid: process.pid,
    model: flags.model ?? '',
    effort,
    promptPath: absPrompt,
    gitRepo: git,
    gitBefore: snapshotFiles(before),
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
  let gitFiles = [];
  let gitRepo = git;
  if (git) {
    const after = (await porcelain(root)) ?? [];
    gitFiles = porcelainDelta(before, after);
  } else {
    gitRepo = false;
  }

  // Mark failed if killed or exited non-zero without emitting a result event.
  // Native exit code and agy status can disagree on completed runs.
  const neverStarted = summary.status == null && result.exitCode !== 0;
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
    gitRepo,
    gitFiles: snapshotFiles(gitFiles),
    claimedFileChanges: summary.claimedFileChanges,
    killed: result.killed || undefined,
    // Persisted so `/agy:result <id>` matches foreground output; omitted when
    // empty.
    stderrTail: result.stderr?.length ? result.stderr : undefined,
    toolErrors: summary.toolErrors?.length ? summary.toolErrors : undefined,
  });

  // Sole write site for detected papercuts. `/agy:result` evaluates anomalies
  // dynamically on read without writing duplicate entries.
  const finalJob = readJob(root, jobId);
  if (finalJob) {
    recordDetected(anomalies(viewFromJob(finalJob)), {
      toolVersion: cachedToolVersion() ?? undefined,
      pluginVersion,
      model: summary.model ?? flags.model ?? undefined,
      repo: root,
      jobId,
      conversationId: summary.conversationId,
      toolCalls: summary.toolCalls,
      filesChanged: gitRepo ? gitFiles.length : undefined,
      agyStatus: summary.status,
      exitCode: result.exitCode,
      writeTargets: summary.writeTargets,
      scratchPaths: summary.scratchPaths,
      toolErrors: summary.toolErrors,
      stderrTail: result.stderr,
    });
  }

  return { result, summary, gitFiles, gitRepo };
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
    return await runAndRecord(flags, prompt, jobId, root);
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
  const flags = parseFlags(collapseCommandArgv(rawArgv));

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

  if (!(await isRepo(process.cwd())) && !flags.noGitCheck) {
    process.stderr.write(
      'Error: current directory is not a git repository. Pass --no-git-check to override.\n',
    );
    return 2;
  }
  const root = await repoRoot(process.cwd());
  pruneOlderThanDays(root, 30);

  if (await isRepo(root)) {
    if (await isDirty(root)) {
      process.stderr.write(
        'Warning: working tree is dirty. agy will see the uncommitted changes.\n',
      );
    }
  }

  // Resolve default model from cache. Omitted on resume because
  // `--conversation` preserves the initial model (e.g. pro), avoiding
  // unintended downgrades.
  if (!flags.model && !isResume(flags)) {
    flags.model = resolveDefaultModel(flags.effort ?? DEFAULT_EFFORT) ?? undefined;
  }

  const taskText = prompt || 'continue';
  const jobId = uniqueJobName(root, taskText);
  const model = flags.model ?? '';

  createJob({
    id: jobId,
    repoPath: root,
    prompt: prompt || 'Continue from where you left off.',
    model,
  });
  process.stdout.write(`agy \`${jobId}\`\n\n`);

  await runOrMarkFailed(flags, prompt || 'Continue from where you left off.', jobId, root);
  const finished = readJob(root, jobId);
  if (finished) process.stdout.write(renderResult(viewFromJob(finished)));
  return 0;
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
