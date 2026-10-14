#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { invokedAsScript, parseCommandArgv, parseTimeout } from './lib/args.mjs';
import { isGitRepo, porcelain, porcelainDelta, repoRoot, snapshotFiles } from './lib/git.mjs';
import { DEFAULT_EFFORT, EFFORTS, parseVersion, runHeadless, versionInfo } from './lib/grok.mjs';
import {
  createJob,
  pruneOlderThanDays,
  rawLogPath,
  readJob,
  uniqueJobName,
  updateJob,
} from './lib/jobs.mjs';
import { pluginVersion, recordDetected } from './lib/papercuts.mjs';
import { summariseEvents } from './lib/parse.mjs';
import { isUnfinished, renderResult, warnings } from './lib/render.mjs';
import { latestRelease, updateNotice } from './update.mjs';

// Runs in the foreground of its child process; the orchestrator invokes it
// under a backgrounded Bash call to receive the exit notification without
// detaching.

const BOOLEAN_FLAGS = ['help'];
const USAGE =
  'Usage: /grok:delegate [--model <id>] [--effort low|medium] [--timeout <sec>] [--session <uuid>] <task... | --prompt-file <path>>\n';

// Implementation runs go long, and grok bills per run. Longer than grok's own
// 3600s idle timeout so grok gets to fail first and say why: its `error`
// event names the cause, a watchdog kill only reports that something was
// killed. Override with --timeout <seconds>.
const DEFAULT_TIMEOUT_SEC = 4800;

/**
 * Read the brief from `--prompt-file <path>` so a long or quote-heavy brief
 * reaches grok without going through the command line. Claude writes the file
 * with its Write tool; this only reads it back.
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
    model:
      typeof flags['model'] === 'string' && flags['model'].trim() ? flags['model'].trim() : undefined,
    effort: typeof flags['effort'] === 'string' ? flags['effort'].trim() : DEFAULT_EFFORT,
    timeout: parseTimeout(flags['timeout'], DEFAULT_TIMEOUT_SEC),
    help: flags['help'] === true,
    session,
    // `undefined` = flag absent; `true` = bare `--prompt-file` with no value
    // (a usage error, caught in main); otherwise the path as given.
    promptFile: flags['prompt-file'],
  };
}

/**
 * The installed grok version, or null when `grok --version` does not answer.
 *
 * @returns {Promise<string|null>}
 */
async function installedVersion() {
  const info = await versionInfo();
  return info.ok ? parseVersion(info.detail) : null;
}

/**
 * @param {ReturnType<typeof parseFlags>} flags
 * @param {string} prompt
 * @param {string} jobId
 * @param {string} root
 * @param {Promise<string|null>} toolVersion
 */
async function runAndRecord(flags, prompt, jobId, root, toolVersion) {
  updateJob(root, jobId, {
    pid: process.pid,
    model: flags.model ?? '',
    effort: flags.effort,
    briefPath: typeof flags.promptFile === 'string' ? flags.promptFile : undefined,
  });

  // Two `git status --porcelain` readings, one either side of the run. grok's
  // write-up is a claim; the wander warning fires when it and the repo
  // disagree.
  const inRepo = await isGitRepo(root);
  const before = inRepo ? ((await porcelain(root)) ?? []) : [];

  // A fresh run names its session up front with `-s`, so a run killed before
  // its `end` event can still be resumed. The id is recorded once grok emits
  // anything other than an error: a refused run (not signed in, a rejected
  // flag) emits only an `error` event and starts no session.
  const sessionId = flags.session ?? randomUUID();
  let sessionRecorded = false;

  const result = await runHeadless({
    prompt,
    model: flags.model,
    effort: flags.effort,
    sessionId: flags.session ? undefined : sessionId,
    resumeSessionId: flags.session,
    timeoutSec: flags.timeout,
    logPath: rawLogPath(root, jobId),
    onSpawn: (cliPid) => {
      try {
        updateJob(root, jobId, { cliPid });
      } catch {
        // A failed pid write must not tear down a running grok.
      }
    },
    onEvent: (ev) => {
      if (sessionRecorded || ev.type === 'error') return;
      sessionRecorded = true;
      try {
        updateJob(root, jobId, { grokSessionId: sessionId });
      } catch {
        // Losing the id costs resumability, not the run.
      }
    },
  });

  const summary = summariseEvents(result.events, root);
  // grok's own `error` event when there is one; otherwise the stderr tail, and
  // only on a failing exit. stderr also carries ordinary progress output, so a
  // healthy run must not raise a warning from it.
  const errorDetail =
    summary.errorDetail ??
    (result.exitCode !== 0 && result.stderrTail.length > 0
      ? result.stderrTail.join('\n')
      : undefined);
  const status = result.exitCode === 0 && summary.success && !result.killed ? 'done' : 'failed';
  const gitFiles = inRepo ? porcelainDelta(before, (await porcelain(root)) ?? []) : [];

  updateJob(root, jobId, {
    status,
    exitCode: result.exitCode,
    finishedAt: new Date().toISOString(),
    summary: summary.summary,
    stopReason: summary.stopReason,
    errorDetail,
    killed: result.killed || undefined,
    failedCommands: summary.failedCommands.length ? summary.failedCommands : undefined,
    toolCalls: summary.toolCalls,
    ...(summary.sessionId ? { grokSessionId: summary.sessionId } : {}),
    gitRepo: inRepo,
    gitFiles: snapshotFiles(gitFiles),
    claimedFileChanges: summary.claimedFileChanges,
  });

  // Sole write site for detected papercuts. `/grok:result` re-renders the
  // same warnings on read without logging them again.
  const finalJob = readJob(root, jobId);
  if (finalJob) {
    recordDetected(warnings(finalJob), {
      toolVersion: (await toolVersion) ?? undefined,
      pluginVersion,
      model: flags.model,
      repo: root,
      jobId,
      sessionId: finalJob.grokSessionId,
      toolCalls: summary.toolCalls,
      exitCode: result.exitCode,
      stopReason: summary.stopReason,
      failedCommands: summary.failedCommands,
    });
  }
}

/**
 * Run `runAndRecord`, marking the job failed if it throws before finishing
 * (grok not found, an unwritable log), then rethrow.
 *
 * @param {ReturnType<typeof parseFlags>} flags
 * @param {string} prompt
 * @param {string} jobId
 * @param {string} root
 * @param {Promise<string|null>} toolVersion
 */
async function runOrMarkFailed(flags, prompt, jobId, root, toolVersion) {
  try {
    await runAndRecord(flags, prompt, jobId, root, toolVersion);
  } catch (err) {
    updateJob(root, jobId, {
      status: 'failed',
      exitCode: 1,
      finishedAt: new Date().toISOString(),
      errorDetail: err instanceof Error ? err.message : String(err),
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

  if (!EFFORTS.includes(flags.effort)) {
    process.stderr.write(
      `Error: --effort must be ${EFFORTS.join(' or ')}; got \`${flags.effort}\`.\n`,
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
  if (!prompt && !flags.session) {
    process.stderr.write('Error: no task description provided.\n');
    process.stderr.write(USAGE);
    return 2;
  }

  const root = await repoRoot(process.cwd());
  pruneOlderThanDays(root, 30);

  // Both run alongside grok, so no dispatch waits on them. The release check
  // reaches the network at most once a day.
  const release = latestRelease().catch(() => null);
  const toolVersion = installedVersion().catch(() => null);

  const jobId = uniqueJobName(root, prompt || 'continue');
  const task = prompt || 'Continue from where you left off.';

  createJob({ id: jobId, repoPath: root, prompt: task, model: flags.model ?? '' });
  process.stdout.write(`grok \`${jobId}\`\n\n`);

  await runOrMarkFailed(flags, task, jobId, root, toolVersion);
  const finished = readJob(root, jobId);

  if (finished) process.stdout.write(renderResult(finished));
  process.stdout.write(updateNotice(await release, await toolVersion));
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
