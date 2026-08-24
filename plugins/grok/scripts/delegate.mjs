#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, openSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collapseCommandArgv, parseArgv, parseTimeout } from './lib/args.mjs';
import { isGitRepo, repoRoot } from './lib/git.mjs';
import { resolveModel, runHeadless } from './lib/grok.mjs';
import { id as newId } from './lib/id.mjs';
import {
  createJob,
  pruneOlderThanDays,
  rawLogPath as rawLogPathFor,
  readJob,
  updateJob,
} from './lib/jobs.mjs';
import { describeToolCall, summariseEvents } from './lib/parse.mjs';
import { ensureDir, jobsDir, logsDir } from './lib/paths.mjs';
import { renderOutcome } from './lib/render.mjs';

const BOOLEAN_FLAGS = ['background', 'wait', 'fresh', 'help', 'resume'];

// Implementation runs go long, and grok bills per run — a watchdog that fires
// too early wastes a paid run, one that never fires lets a stuck run bill on.
// An hour is the compromise; override with --timeout <seconds>.
const DEFAULT_TIMEOUT_SEC = 3600;

function parseFlags(argv) {
  // `honorDoubleDash: false` — `collapseCommandArgv` already consumed the
  // slash-command delimiter, so a `--` left in here is part of the task text.
  const { positional, flags } = parseArgv(argv, BOOLEAN_FLAGS, { honorDoubleDash: false });
  const noGitCheck = flags['no-git-check'] === true || flags['git-check'] === false;
  // `--wait` forces the foreground even if `--background` is also present,
  // so it is a real toggle rather than a no-op.
  const explicitWait = flags['wait'] === true;
  const background = Boolean(flags['background']) && !explicitWait;
  return {
    positional,
    model: typeof flags['model'] === 'string' ? flags['model'] : undefined,
    effort: typeof flags['effort'] === 'string' ? flags['effort'] : undefined,
    background,
    wait: !background,
    fresh: Boolean(flags['fresh']),
    resume: flags['resume'],
    timeout: parseTimeout(flags['timeout'], DEFAULT_TIMEOUT_SEC),
    noGitCheck,
    worker: typeof flags['worker'] === 'string' ? flags['worker'] : undefined,
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

async function runAndRecord(flags, prompt, jobId, root, { live }) {
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
      if (!live) {
        // The background worker records the session id as soon as it appears,
        // so a job killed before `end` is still resumable.
        if (ev.type === 'end' && typeof ev.sessionId === 'string') {
          try {
            updateJob(root, jobId, { grokSessionId: ev.sessionId });
          } catch {
            // noop
          }
        }
        return;
      }
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
  if (live && omitted > 0) {
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

  return { result, summary, status, model };
}

async function foreground(flags, prompt, jobId, root) {
  const model = await resolveModel(flags.model);
  createJob({ id: jobId, repoPath: root, prompt, model });
  process.stdout.write(`grok \`${jobId}\` (${model})\n\n`);

  const { result, summary } = await runAndRecord(flags, prompt, jobId, root, {
    live: true,
  });

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
    }),
  );
  return result.exitCode;
}

function spawnBackground(jobId, argv, root) {
  const selfPath = fileURLToPath(import.meta.url);
  const logPath = rawLogPathFor(root, jobId);
  ensureDir(logsDir(root));
  const out = openSync(`${logPath}.stdout`, 'a');
  const err = openSync(`${logPath}.stderr`, 'a');
  const child = spawn(process.execPath, [selfPath, '--worker', jobId, ...argv], {
    detached: true,
    // Mandatory alongside `detached` on Windows. Without it the OS gives the
    // detached child its own console, which on Win11 surfaces as a Windows
    // Terminal window that opens on dispatch and sits there for the whole life
    // of the job. `killtree.mjs` already sets this on its own spawn; this call
    // was simply missed.
    windowsHide: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, CGD_WORKER: '1', CGD_REPO_ROOT: root },
  });
  child.unref();
  return child.pid ?? -1;
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const flags = parseFlags(collapseCommandArgv(rawArgv));

  if (flags.worker) {
    const root = process.env.CGD_REPO_ROOT ?? (await repoRoot(process.cwd()));
    // Prompt lives on the job JSON (written at createJob). CGD_PROMPT is a
    // one-release fallback so a worker already spawned by a previous plugin
    // version is not broken; scheduled for removal.
    const prompt =
      process.env.CGD_PROMPT ??
      readJob(root, flags.worker)?.prompt ??
      flags.positional.join(' ').trim();
    await runAndRecord(flags, prompt, flags.worker, root, { live: false });
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
    process.stderr.write('Usage: /grok:delegate [flags] <task | --prompt-file <path|->>\n');
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

  if (flags.background) {
    const model = await resolveModel(flags.model);
    createJob({
      id: jobId,
      repoPath: root,
      prompt: prompt || '(resume)',
      model,
      background: true,
    });
    const forwarded = [];
    if (flags.model) forwarded.push('--model', flags.model);
    if (flags.effort) forwarded.push('--effort', flags.effort);
    if (flags.fresh) forwarded.push('--fresh');
    if (flags.resume !== undefined) {
      if (typeof flags.resume === 'boolean') {
        if (flags.resume) forwarded.push('--resume');
      } else {
        forwarded.push(`--resume=${flags.resume}`);
      }
    }
    forwarded.push('--timeout', String(flags.timeout));
    const pid = spawnBackground(jobId, forwarded, root);
    updateJob(root, jobId, { pid });
    process.stdout.write(
      `Job \`${jobId}\` started in background (model \`${model}\`, pid ${pid}).\n`,
    );
    process.stdout.write(`Fetch the write-up with \`/grok:result ${jobId}\` once it finishes.\n`);
    return 0;
  }

  return foreground(flags, prompt || '(resume)', jobId, root);
}

import { invokedAsScript as __isScript } from './lib/invoked.mjs';
const invokedAsScript = __isScript(import.meta.url);

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `delegate failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(1);
    });
}
