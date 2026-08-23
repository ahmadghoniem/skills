#!/usr/bin/env node
import { spawn } from 'node:child_process';
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
  updateJob,
} from './lib/jobs.mjs';
import { describeToolCall, summariseEvents } from './lib/parse.mjs';
import { ensureDir, jobsDir, logsDir } from './lib/paths.mjs';
import { costLine, renderRunDetail } from './lib/render.mjs';

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

  let toolCalls = 0;
  let omitted = 0;
  const result = await runHeadless({
    prompt,
    model,
    effort: flags.effort,
    resumeSessionId: sessionId,
    resumeLatest: resume && !sessionId,
    timeoutSec: flags.timeout,
    logPath,
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
      const label = describeToolCall(ev);
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
    filesTouched: summary.filesTouched,
    failedCommands: summary.failedCommands,
    costUsd: summary.costUsd,
    numTurns: summary.numTurns,
    stopReason: summary.stopReason,
    model: summary.resolvedModel ?? model,
    ...(summary.sessionId ? { grokSessionId: summary.sessionId } : {}),
  });

  return { result, summary, status, model };
}

async function foreground(flags, prompt, jobId, root) {
  const model = await resolveModel(flags.model);
  createJob({ id: jobId, repoPath: root, prompt, model });
  process.stdout.write(
    `Job \`${jobId}\` started on model \`${model}\`${flags.effort ? ` (effort: ${flags.effort})` : ''} (foreground).\n\n`,
  );

  const { result, summary, status } = await runAndRecord(flags, prompt, jobId, root, {
    live: true,
  });

  process.stdout.write('\n---\n');
  process.stdout.write(`**Status:** ${status}\n`);
  process.stdout.write(`**Model:** ${summary.resolvedModel ?? model}\n`);
  if (summary.stopReason && summary.stopReason !== 'end_turn') {
    process.stdout.write(`**Stop reason:** ${summary.stopReason}\n`);
  }
  process.stdout.write(costLine(summary));
  if (result.killed) {
    process.stdout.write('**⚠ Run was killed before finishing** (timeout/watchdog).\n');
  }
  process.stdout.write('\n');
  process.stdout.write(renderRunDetail(summary));
  process.stdout.write('**Summary:**\n\n');
  process.stdout.write(summary.summary.trim() + '\n');
  if (summary.sessionId) {
    process.stdout.write(
      `\n**Grok session:** \`${summary.sessionId}\` — continue with \`/grok:delegate --resume=${summary.sessionId} <follow-up>\`.\n`,
    );
  } else if (result.killed) {
    // `end` is the only streaming event that carries `sessionId`. A watchdog
    // kill never delivers it, so printing a --resume line would point at
    // nothing. Say so rather than implying the session is continuable.
    process.stdout.write(
      '\n**Grok session:** lost — the run was killed before grok reported a session id, so this job cannot be resumed.\n',
    );
  }
  process.stdout.write(`\nRun \`/grok:result ${jobId}\` for the full record.\n`);
  return result.exitCode;
}

function spawnBackground(jobId, argv, root, extraEnv = {}) {
  const selfPath = fileURLToPath(import.meta.url);
  const logPath = rawLogPathFor(root, jobId);
  ensureDir(logsDir(root));
  const out = openSync(`${logPath}.stdout`, 'a');
  const err = openSync(`${logPath}.stderr`, 'a');
  const child = spawn(process.execPath, [selfPath, '--worker', jobId, ...argv], {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, CGD_WORKER: '1', CGD_REPO_ROOT: root, ...extraEnv },
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
    // The prompt is handed over verbatim via env to avoid a second collapse
    // pass mangling quotes/backslashes; fall back to positional for safety.
    const prompt = process.env.CGD_PROMPT ?? flags.positional.join(' ').trim();
    const root = process.env.CGD_REPO_ROOT ?? (await repoRoot(process.cwd()));
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
    const pid = spawnBackground(jobId, forwarded, root, prompt ? { CGD_PROMPT: prompt } : {});
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
