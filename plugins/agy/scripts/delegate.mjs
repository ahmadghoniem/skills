#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import {
  MAX_STDIN_CHARS,
  buildArgs,
  cachedToolVersion,
  installAgent,
  bashServerEntry,
  installBashServer,
  modelCacheStale,
  refreshModelCache,
  runHeadless,
  stdinLine,
  taskMessage,
} from './lib/agy.mjs';
import { invokedAsScript, parseCommandArgv, parseTimeout } from './lib/args.mjs';
import { repoRoot, shortHistory } from './lib/git.mjs';
import {
  agyLogPath,
  createJob,
  readJob,
  uniqueJobName,
  updateJob,
} from './lib/jobs.mjs';
import { pluginVersion, recordDetected } from './lib/papercuts.mjs';
import { summariseEvents } from './lib/parse.mjs';
import { anomalies, isUnfinished, renderResult } from './lib/render.mjs';
import { latestRelease, updateNotice } from './update.mjs';

// Runs in the foreground of its child process; the orchestrator invokes it
// under a backgrounded bash call to receive exit notifications without
// detaching.

/** The model of a fresh job with no `--model`. Its id carries the effort level. */
const DEFAULT_MODEL = 'gemini-4-hydrogen-medium';

/** The agy agent every fresh job runs. */
const AGENT = 'bash-delegate';

const BOOLEAN_FLAGS = ['sandbox', 'help', 'continue'];
const USAGE =
  'Usage: /agy:delegate [--model <id>] [--timeout <sec>] [--sandbox] [--conversation <uuid>] [--continue] <task... | --prompt-file <path>>\n';

/**
 * Read the brief from `--prompt-file <path>` so a long or quote-heavy brief
 * reaches agy without going through the command line. Claude writes the file
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
  const conversation =
    typeof flags['conversation'] === 'string' && flags['conversation'].trim()
      ? String(flags['conversation']).trim()
      : undefined;
  const continueLatest = flags['continue'] === true;
  return {
    positional,
    model: typeof flags['model'] === 'string' ? flags['model'] : undefined,
    effort: flags['effort'],
    timeout: parseTimeout(flags['timeout'], 0),
    sandbox: flags['sandbox'] === true,
    help: flags['help'] === true,
    conversation,
    continueLatest,
    // `undefined` = flag absent; `true` = bare `--prompt-file` with no value
    // (a usage error, caught in main); otherwise the path as given.
    promptFile: flags['prompt-file'],
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
  // The models keep scratch files out of the workspace on their own, so no scratch
  // folder is named.
  const isGit = existsSync(`${root}/.git`);
  const message = isResume(flags)
    ? prompt
    : taskMessage({ workspace: root, isGit, history: isGit ? await shortHistory(root) : undefined, task: prompt });
  if (message.length > MAX_STDIN_CHARS) {
    throw new Error(
      `message is ${message.length} chars, over the ${MAX_STDIN_CHARS} agy reads from stdin, so agy was not started: shorten the brief or split the task`,
    );
  }

  // A resumed conversation keeps the agent it started with.
  const agent = isResume(flags) ? undefined : AGENT;
  if (agent) installAgent(agent);
  // agy reads its MCP servers from the global config on every start, resume
  // included, so the bash tool needs no per-run flag. The agent relies on it
  // for every search and edit, so a run without it stops here.
  try {
    installBashServer();
  } catch (err) {
    throw new Error(`bash tool not installed, so agy was not started: ${err instanceof Error ? err.message : String(err)}`);
  }
  const bashScript = bashServerEntry().args[0];
  if (!existsSync(bashScript)) {
    throw new Error(`bash tool not installed, so agy was not started: ${bashScript} is missing`);
  }

  updateJob(root, jobId, {
    pid: process.pid,
    model: flags.model ?? '',
    agent,
    sandbox: flags.sandbox || undefined,
    briefPath: typeof flags.promptFile === 'string' ? flags.promptFile : undefined,
  });

  const args = buildArgs({
    addDir: isResume(flags) ? undefined : root,
    printTimeoutSec: flags.timeout,
    logFile: agyLogPath(root, jobId),
    model: flags.model,
    agent,
    sandbox: flags.sandbox,
    conversationId: flags.conversation,
    continueLatest: flags.continueLatest && !flags.conversation,
  });

  const result = await runHeadless({
    args,
    input: stdinLine(message),
    cwd: root,
    onSpawn: (cliPid) => {
      try {
        updateJob(root, jobId, { cliPid });
      } catch {
        // A failed pid write must not tear down a running agy.
      }
    },
    onEvent: (ev) => {
      // `/agy:result` finds the brain transcript of a running job by this id.
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

  // agy stops itself at the print timeout, returns partial output and sets
  // `finished_reason: print_timeout`. Only its stderr notice names the duration.
  const timeoutLine = (result.stderr ?? []).find((l) => /^\[agy\] print timeout after \S+/.test(l));
  const timedOut = summary.finishedReason === 'print_timeout' || Boolean(timeoutLine);
  const timedOutAfter = timeoutLine ? /after (\S+)/.exec(timeoutLine)[1] : undefined;

  // Mark failed if agy exited non-zero without emitting a result
  // event (spawn failure), or if agy did no work at all (status ERROR with no
  // conversation id — an unknown model, a rejected flag). Native exit code and
  // agy status can otherwise disagree on completed runs.
  const neverStarted =
    (summary.status == null && result.exitCode !== 0) ||
    (String(summary.status).toUpperCase() === 'ERROR' && !summary.conversationId);
  const pluginStatus = neverStarted ? 'failed' : 'done';
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
    timedOut: timedOut || undefined,
    timedOutAfter,
    finishedReason: summary.finishedReason,
    // Persisted so `/agy:result <id>` matches foreground output; omitted when
    // empty.
    stderrTail: result.stderr?.length ? result.stderr : undefined,
    toolErrors: summary.toolErrors?.length ? summary.toolErrors : undefined,
    compactions: summary.compactions || undefined,
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

  const root = await repoRoot(process.cwd());

  if (flags.effort !== undefined) {
    process.stderr.write(
      'Error: --effort is not an option. Pass a full model id, which carries the level: --model gemini-4-hydrogen-high.\n',
    );
    return 2;
  }

  // A resumed conversation keeps the model it started with.
  if (!flags.model && !isResume(flags)) flags.model = DEFAULT_MODEL;

  // Once a day, alongside the run, so no dispatch waits on GitHub.
  const release = latestRelease().catch(() => null);

  const jobId = uniqueJobName(root, prompt || 'continue');
  const task = prompt || 'Continue from where you left off.';

  createJob({ id: jobId, repoPath: root, prompt: task, model: flags.model ?? '' });
  process.stdout.write(`agy \`${jobId}\`\n\n`);

  await runOrMarkFailed(flags, task, jobId, root);
  const finished = readJob(root, jobId);

  // Refresh right away on a rejected model, so the `Valid ids:` list
  // `renderResult` prints below is current.
  if (finished && /invalid model selection/i.test(String(finished.error ?? ''))) {
    await refreshModelCache().catch(() => {});
  }

  if (finished) process.stdout.write(renderResult(finished));
  process.stdout.write(updateNotice(await release, cachedToolVersion()));
  const code = finished && isUnfinished(finished) ? 1 : 0;

  // Weekly, after the output above is written, and before
  // returning — never a detached process. Swallowed so a failed refresh
  // cannot change the exit code.
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
