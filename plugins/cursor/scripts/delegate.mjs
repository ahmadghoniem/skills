#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collapseCommandArgv, parseArgv, parseTimeout } from './lib/args.mjs';
import { resolveModel, runHeadless } from './lib/cursor.mjs';
import { isGitRepo, repoRoot } from './lib/git.mjs';
import { id as newId } from './lib/id.mjs';
import {
  createJob,
  pruneOlderThanDays,
  rawLogPath as rawLogPathFor,
  updateJob,
} from './lib/jobs.mjs';
import { ensureDir, jobsDir, logsDir } from './lib/paths.mjs';
import {
  extractChatId,
  extractResolvedModel,
  isFileWriteTool,
  pickToolPath,
  summariseEvents,
  walkToolUses,
} from './lib/parse.mjs';
import { renderRunDetail } from './lib/render.mjs';

const BOOLEAN_FLAGS = ['background', 'wait', 'fresh', 'force', 'cloud', 'help', 'resume'];

function parseFlags(argv) {
  // `honorDoubleDash: false` — `collapseCommandArgv` already consumed the
  // slash-command delimiter, so a `--` left in here is part of the task text.
  // Without this, a task containing `--` silently swallowed every flag after
  // it (e.g. `--model`) and the run proceeded on the default model.
  const { positional, flags } = parseArgv(argv, BOOLEAN_FLAGS, { honorDoubleDash: false });
  const fresh = Boolean(flags['fresh']);
  const cloud = Boolean(flags['cloud']);
  // Single canonical spelling: `--no-git-check`. The parser's `--no-*`
  // negation unconditionally populates both `git-check` (false) and its
  // camelCase mirror from that one token, so checking `git-check === false`
  // alongside the rare explicit `--no-git-check=true` form is the whole of
  // the "minimal internal normalization" needed here.
  const noGitCheck = flags['no-git-check'] === true || flags['git-check'] === false;
  const explicitForceFlag = 'force' in flags ? Boolean(flags['force']) : undefined;
  const force = explicitForceFlag === undefined ? true : explicitForceFlag;
  // `--wait` forces the foreground even if `--background` is also present,
  // so it is a real toggle rather than a no-op.
  const explicitWait = flags['wait'] === true;
  const background = Boolean(flags['background']) && !explicitWait;
  const wait = !background;
  const timeout = parseTimeout(flags['timeout']);
  const resume = flags['resume'];
  const model = typeof flags['model'] === 'string' ? flags['model'] : undefined;
  const worker = typeof flags['worker'] === 'string' ? flags['worker'] : undefined;
  // `undefined` = flag absent; `'-'` = stdin; a string path; `true` = bare
  // `--prompt-file` with no value (a usage error, caught in main).
  const promptFile = flags['prompt-file'];
  return {
    positional,
    model,
    background,
    wait,
    fresh,
    resume,
    force,
    cloud,
    timeout,
    noGitCheck,
    worker,
    promptFile,
  };
}

/**
 * Resolve `--prompt-file <path>` / `--prompt-file -` (stdin) into the actual
 * prompt text. Lets callers pass long, multi-line, or quote-heavy prompts
 * without CLI-arg mangling — the same robustness the background worker already
 * gets from `CCD_PROMPT`. Returns the trimmed text; throws on a missing value,
 * missing file, or empty content.
 *
 * @param {unknown} spec  raw flag value: `'-'` for stdin, a path, or `true` when bare
 * @returns {string}
 */
function readPromptSource(spec) {
  if (spec === true || spec === '') {
    throw new Error('--prompt-file needs a path, or `-` to read stdin.');
  }
  let raw;
  if (spec === '-') {
    // fd 0 = stdin; a synchronous read matches the one-shot nature of the command.
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
  // Any non-boolean value (string id, or a numeric id auto-cast by the parser)
  // means "resume" — with an explicit chat id when one was supplied.
  return true;
}

function resumeChatId(resume) {
  if (resume == null || typeof resume === 'boolean') return undefined;
  const s = String(resume).trim();
  if (s.length > 0 && s.toLowerCase() !== 'true') return s;
  return undefined;
}

async function foreground(flags, prompt, jobId, root) {
  const model = resolveModel(flags.model);
  const logPath = rawLogPathFor(root, jobId);
  ensureDir(jobsDir(root));
  ensureDir(logsDir(root));
  createJob({
    id: jobId,
    repoPath: root,
    prompt,
    model,
    cloud: flags.cloud,
  });
  updateJob(root, jobId, { pid: process.pid });

  const resume = isResumeRequested(flags.resume, flags.fresh);
  const resumeId = resume ? resumeChatId(flags.resume) : undefined;

  process.stdout.write(`Job \`${jobId}\` started on model \`${model}\` (foreground).\n\n`);

  // Tool-use blocks are typically nested inside `assistant.message.content[]`
  // (Anthropic Messages API shape), not flat on the event — `walkToolUses`
  // finds them wherever they live. Progress lines show "tool → file" when the
  // tool looks like a file write and a path can be extracted, so a human
  // skimming a long-running job sees *what* is being touched, not just a
  // bare tool name (or, worse, a collapsed "• tool ×N" counter).
  let toolCalls = 0;
  let omittedToolCalls = 0;
  const result = await runHeadless({
    prompt,
    model,
    resumeChatId: resumeId,
    resumeLatest: resume && !resumeId,
    cloud: flags.cloud,
    force: flags.force,
    timeoutSec: flags.timeout,
    logPath,
    onEvent: (ev) => {
      for (const tu of walkToolUses(ev)) {
        toolCalls += 1;
        if (toolCalls > 20) {
          omittedToolCalls += 1;
          continue;
        }
        const path = isFileWriteTool(tu.name) ? pickToolPath(tu.input) : undefined;
        process.stdout.write(path ? `• ${tu.name} → ${path}\n` : `• ${tu.name}\n`);
      }
    },
  });
  if (omittedToolCalls > 0) {
    process.stdout.write(
      `• … (${omittedToolCalls} further tool call${omittedToolCalls === 1 ? '' : 's'} omitted)\n`,
    );
  }

  const summary = summariseEvents(result.events, root);
  const chatId = extractChatId(result.events);
  // If the caller asked for `auto`, prefer whatever concrete model id the
  // stream reveals Cursor actually picked — the job record should say what
  // ran, not just the placeholder that was requested (issue F).
  const resolvedModel = model === 'auto' ? (extractResolvedModel(result.events) ?? model) : model;
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
    model: resolvedModel,
    ...(chatId ? { cursorChatId: chatId } : {}),
  });

  process.stdout.write('\n---\n');
  process.stdout.write(`**Status:** ${status}\n`);
  // Echo the model that actually ran. The start line prints the *requested*
  // model, so without this an `auto` run — or a `--model` that never arrived —
  // is invisible in the result.
  process.stdout.write(`**Model:** ${resolvedModel}\n`);
  if (result.killed)
    process.stdout.write('**⚠ Run was killed before finishing** (timeout/watchdog).\n');
  process.stdout.write('\n');
  process.stdout.write(renderRunDetail(summary));
  if (summary.summary) {
    process.stdout.write('**Summary:**\n\n');
    process.stdout.write(summary.summary.trim() + '\n');
  }
  if (chatId) {
    process.stdout.write(
      `\n**Cursor chat id:** \`${chatId}\` — resume with \`cursor-agent --resume=${chatId}\`.\n`,
    );
  }
  process.stdout.write(`\nRun \`/cursor:result ${jobId}\` for the full record.\n`);
  return result.exitCode;
}

function spawnBackground(jobId, argv, root, extraEnv = {}) {
  const selfPath = fileURLToPath(import.meta.url);
  // Base the capture logs on the resolved repo root (not process.cwd()) so they
  // land in the same jobs/<repo-hash>/ dir as the job record and NDJSON.
  const logPath = rawLogPathFor(root, jobId);
  ensureDir(logsDir(root));
  const out = openSync(`${logPath}.stdout`, 'a');
  const err = openSync(`${logPath}.stderr`, 'a');
  const child = spawn(process.execPath, [selfPath, '--worker', jobId, ...argv], {
    detached: true,
    stdio: ['ignore', out, err],
    env: {
      ...process.env,
      CCD_WORKER: '1',
      CCD_REPO_ROOT: root,
      ...extraEnv,
    },
  });
  child.unref();
  return child.pid ?? -1;
}

async function runWorker(jobId, flags, prompt, root) {
  const model = resolveModel(flags.model);
  const logPath = rawLogPathFor(root, jobId);
  updateJob(root, jobId, { pid: process.pid, model });
  const resume = isResumeRequested(flags.resume, flags.fresh);
  const resumeId = resume ? resumeChatId(flags.resume) : undefined;
  const result = await runHeadless({
    prompt,
    model,
    resumeChatId: resumeId,
    resumeLatest: resume && !resumeId,
    cloud: flags.cloud,
    force: flags.force,
    timeoutSec: flags.timeout,
    logPath,
    onEvent: (ev) => {
      const chatId = ev.chat_id ?? ev.chatId ?? ev.session_id ?? ev.sessionId;
      if (typeof chatId === 'string' && chatId.length > 0) {
        try {
          updateJob(root, jobId, { cursorChatId: chatId });
        } catch {
          // noop
        }
      }
    },
  });
  const summary = summariseEvents(result.events, root);
  const chatId = extractChatId(result.events);
  const resolvedModel = model === 'auto' ? (extractResolvedModel(result.events) ?? model) : model;
  const status = result.exitCode === 0 && summary.success && !result.killed ? 'done' : 'failed';
  const killedNote = result.killed
    ? '\n\n[plugin post-flight]\nThe run was killed (timeout or watchdog) before finishing — output may be incomplete.'
    : '';
  updateJob(root, jobId, {
    status,
    exitCode: result.exitCode,
    finishedAt: new Date().toISOString(),
    summary: summary.summary + killedNote,
    filesTouched: summary.filesTouched,
    failedCommands: summary.failedCommands,
    model: resolvedModel,
    ...(chatId ? { cursorChatId: chatId } : {}),
  });
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
    const prompt = process.env.CCD_PROMPT ?? flags.positional.join(' ').trim();
    const root = process.env.CCD_REPO_ROOT ?? (await repoRoot(process.cwd()));
    await runWorker(flags.worker, flags, prompt, root);
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
    process.stderr.write('Usage: /cursor:delegate [flags] <task | --prompt-file <path|->>\n');
    return 2;
  }

  const inGit = await isGitRepo(process.cwd());
  if (!inGit && !flags.noGitCheck) {
    process.stderr.write(
      'Error: current directory is not a git repository. Pass --no-git-check to override.\n',
    );
    return 2;
  }
  const root = await repoRoot(process.cwd());

  pruneOlderThanDays(root, 30);

  const jobId = newId(10);

  if (flags.background) {
    const model = resolveModel(flags.model);
    createJob({
      id: jobId,
      repoPath: root,
      prompt: prompt || '(resume)',
      model,
      background: true,
      cloud: flags.cloud,
    });
    const forwardedArgs = [];
    if (flags.model) forwardedArgs.push('--model', flags.model);
    if (flags.fresh) forwardedArgs.push('--fresh');
    if (flags.cloud) forwardedArgs.push('--cloud');
    if (flags.resume !== undefined) {
      if (typeof flags.resume === 'boolean') {
        if (flags.resume) forwardedArgs.push('--resume');
      } else {
        // String or numeric id — String() keeps a numeric id from being dropped.
        forwardedArgs.push(`--resume=${flags.resume}`);
      }
    }
    if (!flags.force) forwardedArgs.push('--no-force');
    forwardedArgs.push('--timeout', String(flags.timeout));
    const extraEnv = prompt ? { CCD_PROMPT: prompt } : {};
    const pid = spawnBackground(jobId, forwardedArgs, root, extraEnv);
    updateJob(root, jobId, { pid });
    process.stdout.write(
      `Job \`${jobId}\` started in background (model \`${model}\`, pid ${pid}).\n`,
    );
    process.stdout.write(`Fetch the write-up with \`/cursor:result ${jobId}\` once it finishes.\n`);
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
