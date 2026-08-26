#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { collapseCommandArgv, invokedAsScript, parseArgv, parseTimeout } from './lib/args.mjs';
import { isGitRepo, repoRoot } from './lib/git.mjs';
import { resolveModel, runHeadless } from './lib/grok.mjs';
import { id as newId } from './lib/id.mjs';
import {
  createJob,
  pruneOlderThanDays,
  rawLogPath as rawLogPathFor,
  updateJob,
} from './lib/jobs.mjs';
import { describeToolCall, summariseEvents } from './lib/parse.mjs';
import { ensureDir, jobsDir, logsDir } from './lib/paths.mjs';
import { renderOutcome } from './lib/render.mjs';

const BOOLEAN_FLAGS = ['fresh', 'help', 'resume'];
const USAGE =
  'Usage: /grok:delegate [--model <id>] [--effort <level>] [--timeout <sec>] [--resume[=<id>]] [--fresh] [--no-git-check] <task | --prompt-file <path|->>\n';

// Implementation runs go long, and grok bills per run — a watchdog that fires
// too early wastes a paid run, one that never fires lets a stuck run bill on.
// An hour is the compromise; override with --timeout <seconds>.
const DEFAULT_TIMEOUT_SEC = 3600;

function parseFlags(argv) {
  // `honorDoubleDash: false` — `collapseCommandArgv` already consumed the
  // slash-command delimiter, so a `--` left in here is part of the task text.
  const { positional, flags } = parseArgv(argv, BOOLEAN_FLAGS, { honorDoubleDash: false });
  const noGitCheck = flags['no-git-check'] === true || flags['git-check'] === false;
  return {
    positional,
    model: typeof flags['model'] === 'string' ? flags['model'] : undefined,
    effort: typeof flags['effort'] === 'string' ? flags['effort'] : undefined,
    fresh: Boolean(flags['fresh']),
    resume: flags['resume'],
    timeout: parseTimeout(flags['timeout'], DEFAULT_TIMEOUT_SEC),
    noGitCheck,
    help: flags['help'] === true,
    // `undefined` = flag absent; `'-'` = stdin; a string path; `true` = bare
    // `--prompt-file` with no value (a usage error, caught in main).
    promptFile: flags['prompt-file'],
  };
}

/**
 * Resolve `--prompt-file <path>` / `--prompt-file -` (stdin) into prompt text,
 * so a long, multi-line, or quote-heavy brief reaches grok without CLI-arg
 * mangling. Throws on a missing value, missing file, or empty content.
 *
 * @param {unknown} spec  `'-'` for stdin, a path, or `true` when bare
 * @returns {string}
 */
function readPromptSource(spec) {
  if (spec === true || spec === '') {
    throw new Error('--prompt-file needs a path, or `-` to read stdin.');
  }
  let raw;
  if (spec === '-') {
    raw = readFileSync(0, 'utf8');
  } else {
    const path = String(spec);
    if (!existsSync(path)) throw new Error(`prompt file not found: ${path}`);
    raw = readFileSync(path, 'utf8');
  }
  const text = raw.trim();
  if (text.length === 0) {
    throw new Error(spec === '-' ? 'stdin was empty.' : `prompt file is empty: ${spec}`);
  }
  return text;
}

function isResumeRequested(resume, fresh) {
  if (fresh) return false;
  if (resume === undefined) return false;
  if (typeof resume === 'boolean') return resume;
  return true;
}

function resumeSessionId(resume) {
  if (resume == null || typeof resume === 'boolean') return undefined;
  const s = String(resume).trim();
  if (s.length > 0 && s.toLowerCase() !== 'true') return s;
  return undefined;
}

async function runAndRecord(flags, prompt, jobId, root) {
  const model = await resolveModel(flags.model);
  const logPath = rawLogPathFor(root, jobId);
  ensureDir(jobsDir(root));
  ensureDir(logsDir(root));
  updateJob(root, jobId, { pid: process.pid, model });

  const resume = isResumeRequested(flags.resume, flags.fresh);
  const sessionId = resume ? resumeSessionId(flags.resume) : undefined;

  // A fresh dispatch names its own session up front and records it BEFORE grok
  // is spawned, so the job is resumable from the instant it starts. Previously
  // the id arrived only on the terminal `end` event, which meant precisely the
  // runs you most want to resume — killed, crashed, timed out — were the ones
  // that could not be. Verified on grok 1.0.5: a run killed mid-stream with no
  // `end` event still leaves its session on disk under this id, and `-r <uuid>`
  // resumes it with prior context intact.
  const freshSessionId = resume ? undefined : randomUUID();
  if (freshSessionId) {
    try {
      updateJob(root, jobId, { grokSessionId: freshSessionId });
    } catch {
      // Losing the pre-assignment costs resumability, not the run.
    }
  }

  let toolCalls = 0;
  let omitted = 0;
  const result = await runHeadless({
    prompt,
    model,
    effort: flags.effort,
    sessionId: freshSessionId,
    resumeSessionId: sessionId,
    resumeLatest: resume && !sessionId,
    timeoutSec: flags.timeout,
    logPath,
    onSpawn: (cliPid) => {
      try {
        updateJob(root, jobId, { cliPid });
      } catch {
        // A failed pid write must not tear down a running grok.
      }
    },
    onEvent: (ev) => {
      const label = describeToolCall(ev, root);
      if (!label) return;
      toolCalls += 1;
      if (toolCalls > 20) {
        omitted += 1;
        return;
      }
      process.stdout.write(`• ${label}\n`);
    },
  });
  if (omitted > 0) {
    process.stdout.write(`• … (${omitted} further tool call${omitted === 1 ? '' : 's'} omitted)\n`);
  }

  const summary = summariseEvents(result.events, root);
  const status = result.exitCode === 0 && summary.success && !result.killed ? 'done' : 'failed';
  const killedNote = result.killed
    ? '\n\n[plugin post-flight]\nThe run was killed (timeout or watchdog) before finishing — output may be incomplete. Re-run with a larger `--timeout` if needed.'
    : '';

  updateJob(root, jobId, {
    status,
    exitCode: result.exitCode,
    finishedAt: new Date().toISOString(),
    summary: summary.summary + killedNote,
    failedCommands: summary.failedCommands,
    stopReason: summary.stopReason,
    model,
    ...(summary.sessionId ? { grokSessionId: summary.sessionId } : {}),
  });

  // `freshSessionId` travels out because the caller renders the resume line
  // from it: on a watchdog kill no `end` event arrives, so the pre-assigned id
  // is the only one that exists.
  return { result, summary, status, model, freshSessionId };
}

async function foreground(flags, prompt, jobId, root) {
  const model = await resolveModel(flags.model);
  createJob({ id: jobId, repoPath: root, prompt, model });
  process.stdout.write(`grok \`${jobId}\` (${model})\n\n`);

  const { result, summary, freshSessionId } = await runAndRecord(flags, prompt, jobId, root);

  process.stdout.write('\n');
  process.stdout.write(
    renderOutcome({
      summary: summary.summary,
      stopReason: summary.stopReason,
      exitCode: result.exitCode,
      killed: result.killed,
      failedCommands: summary.failedCommands,
      // `end` is the only streaming event carrying `sessionId`, so a watchdog
      // kill never delivers one. Saying the job is unresumable beats printing a
      // resume line that points at nothing.
      // A fresh dispatch pre-assigns its id, so this can now only fire on a
      // resume — where `-s` is illegal and the id must still come from `end`.
      sessionLost: result.killed && !summary.sessionId && !freshSessionId,
      // The inverse: killed, but an id exists to attach to. A fresh dispatch
      // pre-assigns one with `-s`, so this is the usual shape of a watchdog
      // kill and the run is resumable rather than lost.
      resumableSessionId: result.killed
        ? (summary.sessionId ?? freshSessionId)
        : undefined,
    }),
  );
  return result.exitCode;
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const flags = parseFlags(collapseCommandArgv(rawArgv));

  // `help` was declared as a boolean flag but never read, so `--help` fell
  // through and billed a real run. Checked before anything else, including the
  // `--resume` that `/grok:resume` injects ahead of it.
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
      prompt = readPromptSource(flags.promptFile);
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
  }
  if (!prompt && !isResumeRequested(flags.resume, flags.fresh)) {
    process.stderr.write('Error: no task description provided.\n');
    process.stderr.write(USAGE);
    return 2;
  }

  if (!(await isGitRepo(process.cwd())) && !flags.noGitCheck) {
    process.stderr.write(
      'Error: current directory is not a git repository. Pass --no-git-check to override.\n',
    );
    return 2;
  }
  const root = await repoRoot(process.cwd());
  pruneOlderThanDays(root, 30);

  const jobId = newId(10);

  return foreground(flags, prompt || '(resume)', jobId, root);
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
