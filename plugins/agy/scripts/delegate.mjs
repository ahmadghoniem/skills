#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import {
  DEFAULT_PRINT_TIMEOUT_SEC,
  MAX_STDIN_CHARS,
  WATCHDOG_GRACE_SEC,
  buildArgs,
  cachedModels,
  cachedToolVersion,
  familyLevels,
  installAgent,
  installBashServer,
  modelCacheStale,
  refreshModelCache,
  resolveDefaultModel,
  runHeadless,
  sidecarPrint,
  stdinLine,
  taskMessage,
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
import { latestRelease, updateNotice } from './update.mjs';

// Runs in the foreground of its child process; the orchestrator invokes it
// under a backgrounded bash call to receive exit notifications without
// detaching. agy models encode effort (e.g. `gemini-3.7-flash-low`); medium is
// default unless overridden by `--effort`.
const DEFAULT_EFFORT = 'medium';

const BOOLEAN_FLAGS = ['sandbox', 'help', 'continue'];
const USAGE =
  'Usage: /agy:delegate [--model <id>] [--effort <level>] [--timeout <sec>] [--sandbox] [--conversation <uuid>] [--continue] <task... | --prompt-file <path>>\n';

/**
 * The repository's rules to inline in the first message: AGENTS.md, or
 * CLAUDE.md when AGENTS.md is missing or empty.
 *
 * @param {string} root
 * @returns {{name: string, text: string}|null}
 */
function repoRules(root) {
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    try {
      const text = readFileSync(join(root, name), 'utf8');
      if (text.trim()) return { name, text };
    } catch {
      // try the next one
    }
  }
  return null;
}

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
    effort: typeof flags['effort'] === 'string' ? flags['effort'] : undefined,
    timeout: parseTimeout(flags['timeout'], DEFAULT_PRINT_TIMEOUT_SEC),
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
 * Whether `model` is a known family or full id in `models` — either key of
 * `familyLevels(models)`, since a family and a full id with no levels are
 * both stored as keys with possibly-empty sets.
 *
 * @param {string|undefined} model
 * @param {import('./lib/agy.mjs').ModelInfo[]|null} models
 * @returns {boolean}
 */
function isModelCached(model, models) {
  if (!model || !Array.isArray(models)) return false;
  return familyLevels(models).has(model) || models.some((m) => m.id === model);
}

/**
 * @param {ReturnType<typeof parseFlags>} flags
 * @param {string} prompt
 * @param {string} jobId
 * @param {string} root
 */
async function runAndRecord(flags, prompt, jobId, root) {
  // A resumed conversation already has the environment note and the rules.
  const message = isResume(flags)
    ? prompt
    : taskMessage({
        workspace: root,
        isGit: existsSync(join(root, '.git')),
        rules: repoRules(root),
        task: prompt,
      });
  // Kept for the record, and read by agy when the message is too long for stdin.
  const absPrompt = resolvePath(promptPath(root, jobId));
  writeFileSync(absPrompt, message, 'utf8');
  const viaFile = message.length > MAX_STDIN_CHARS;

  // `buildArgs` drops `--effort` when the model id already encodes a level.
  // Any other mismatch goes to agy, whose error names the levels the model has.
  const effort = flags.effort;

  // A resumed conversation keeps the agent it started with.
  // `CAD_AGY_AGENT=default` runs agy's own agent, for comparing the two.
  const agent =
    isResume(flags) || process.env.CAD_AGY_AGENT === 'default'
      ? undefined
      : 'agy-delegate';
  if (agent) installAgent(agent);
  // agy reads its MCP servers from the global config on every start, resume
  // included, so the bash tool needs no per-run flag.
  try {
    installBashServer();
  } catch (err) {
    process.stderr.write(`Warning: bash tool not installed: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  updateJob(root, jobId, {
    pid: process.pid,
    model: flags.model ?? '',
    effort,
    promptPath: absPrompt,
    sandbox: flags.sandbox || undefined,
    briefPath: typeof flags.promptFile === 'string' ? flags.promptFile : undefined,
  });

  const args = buildArgs({
    addDir: isResume(flags) ? undefined : root,
    print: viaFile ? sidecarPrint(absPrompt) : undefined,
    printTimeoutSec: flags.timeout,
    logFile: agyLogPath(root, jobId),
    model: flags.model,
    effort,
    agent,
    sandbox: flags.sandbox,
    conversationId: flags.conversation,
    continueLatest: flags.continueLatest && !flags.conversation,
  });

  const result = await runHeadless({
    args,
    input: viaFile ? undefined : stdinLine(message),
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
  pruneOlderThanDays(root, 30);

  // Resolve default model from cache. Omitted on resume because
  // `--conversation` preserves the initial model (e.g. pro), avoiding
  // unintended downgrades.
  if (!flags.model && !isResume(flags)) {
    flags.model = resolveDefaultModel(flags.effort ?? DEFAULT_EFFORT) ?? undefined;
  }

  // A model named today must not be rejected by a week-old cache. Refresh
  // once, before the run starts, when it is not cached yet.
  if (flags.model && !isResume(flags) && !isModelCached(flags.model, cachedModels())) {
    await refreshModelCache().catch(() => {});
  }

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
