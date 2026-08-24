#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { openSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PRINT_TIMEOUT_SEC,
  WATCHDOG_GRACE_SEC,
  buildArgs,
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
import { summariseEvents } from './lib/parse.mjs';
import { ensureDir, jobsDir } from './lib/paths.mjs';
import { renderResult, viewFromJob } from './lib/render.mjs';

// `--wait` is accepted and ignored. Foreground is the default now: the
// orchestrator runs this under a backgrounded Bash call, which keeps the user's
// session free *and* lets the harness announce the exit. The detached
// `--background` worker severs that notification and forces polling, so it is
// opt-in only.
const BOOLEAN_FLAGS = ['wait', 'sandbox', 'help', 'continue', 'background'];
const USAGE =
  'Usage: /agy:delegate [--model <id>] [--effort <level>] [--timeout <sec>] [--sandbox] [--no-git-check] [--conversation <uuid>] [--continue] [--background] <task...>\n';

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
    background: flags['background'] === true,
    timeout: parseTimeout(flags['timeout'], DEFAULT_PRINT_TIMEOUT_SEC),
    noGitCheck,
    sandbox: flags['sandbox'] === true,
    help: flags['help'] === true,
    conversation,
    continueLatest,
    worker: typeof flags['worker'] === 'string' ? flags['worker'] : undefined,
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

  // `done` used to mean "not killed", so a spawn failure that produced no
  // result at all was still recorded as done and listed that way by
  // `/agy:result --list`. A non-zero exit alone is not enough to call it failed
  // — agy's status and exit code are documented to disagree in both directions,
  // and a good report with a stray non-zero exit is still a good report. But a
  // non-zero exit with no `result` event at all means agy never got started.
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
    // Persisted so `/agy:result <id>` renders exactly what the foreground run
    // did. Both stay undefined when empty, keeping a clean job record clean.
    stderrTail: result.stderr?.length ? result.stderr : undefined,
    toolErrors: summary.toolErrors?.length ? summary.toolErrors : undefined,
  });

  return { result, summary, gitFiles, gitRepo };
}

function spawnBackground(jobId, argv, root) {
  const selfPath = fileURLToPath(import.meta.url);
  const logPath = rawLogPathFor(root, jobId);
  ensureDir(jobsDir(root));
  const out = openSync(`${logPath}.stdout`, 'a');
  const err = openSync(`${logPath}.stderr`, 'a');
  const child = spawn(process.execPath, [selfPath, '--worker', jobId, ...argv], {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, CAD_WORKER: '1', CAD_REPO_ROOT: root },
    windowsHide: true,
  });
  child.unref();
  return child.pid ?? -1;
}

function forwardFlags(flags) {
  /** @type {string[]} */
  const forwarded = [];
  if (flags.model) forwarded.push('--model', flags.model);
  if (flags.effort) forwarded.push('--effort', flags.effort);
  if (flags.sandbox) forwarded.push('--sandbox');
  if (flags.conversation) forwarded.push('--conversation', flags.conversation);
  if (flags.continueLatest) forwarded.push('--continue');
  forwarded.push('--timeout', String(flags.timeout));
  return forwarded;
}

/**
 * `runAndRecord`, but a throw still moves the record off `running`.
 *
 * `createJob` writes `status: 'running'` and the only thing that writes a
 * terminal status is `runAndRecord`'s own final `updateJob`. Anything that
 * throws before that — `resolveBin()` when agy is not installed is the likely
 * one, and it is not pre-empted by model resolution, which swallows errors —
 * used to strand the record at `running` forever. `/agy:result` then answers
 * "still running, re-run once it finishes" for a run that never started.
 *
 * The error is rethrown: the caller still fails, it just fails legibly.
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

  if (flags.worker) {
    const root = process.env.CAD_REPO_ROOT ?? (await repoRoot(process.cwd()));
    const prompt = readJob(root, flags.worker)?.prompt ?? flags.positional.join(' ').trim();
    await runOrMarkFailed(flags, prompt, flags.worker, root);
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

  // Cache read, not a network call — see `cachedModels`. Resolved once here in
  // the dispatcher and forwarded to the worker, so a backgrounded run does not
  // repeat it. A cold cache yields null, which means "send no `--model`" and
  // lets agy pick its own default; `/agy:setup` is what fills the cache.
  //
  // Skipped entirely on a resume: `--conversation` already carries the model the
  // conversation was started with, and pinning the auto-picked flash id here
  // would silently downgrade a follow-up to a run the user deliberately started
  // on a pro model.
  if (!flags.model && !isResume(flags)) {
    flags.model = resolveDefaultModel() ?? undefined;
  }

  const taskText = prompt || 'continue';
  const jobId = uniqueJobName(root, taskText);
  const model = flags.model ?? '';

  if (flags.background) {
    createJob({
      id: jobId,
      repoPath: root,
      prompt: prompt || 'Continue from where you left off.',
      model,
      background: true,
    });
    const pid = spawnBackground(jobId, forwardFlags(flags), root);
    updateJob(root, jobId, { pid });
    process.stdout.write(`${jobId}\n`);
    process.stdout.write(
      `Job \`${jobId}\` started in background (pid ${pid}). Collect with \`/agy:result ${jobId}\`.\n`,
    );
    return 0;
  }

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
