import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main as delegateMain } from '../scripts/delegate.mjs';
import { jobDonePath, listJobs, readJob } from '../scripts/lib/jobs.mjs';
import { main as resultMain } from '../scripts/result.mjs';
import { main as resumeMain } from '../scripts/resume.mjs';
import { main as statusMain } from '../scripts/status.mjs';
import { HAPPY_FIXTURE, NESTED_TOOL_USE_FIXTURE, STUB_BIN, makeTempHome } from './helpers.mjs';

describe('delegate foreground', () => {
  let tmp;
  const prevHome = process.env.CCD_HOME;
  const prevBin = process.env.CURSOR_AGENT_BIN;
  const prevFix = process.env.CURSOR_AGENT_STUB_FIXTURE;
  const prevCwd = process.cwd();

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CCD_HOME = tmp.dir;
    process.env.CURSOR_AGENT_BIN = STUB_BIN;
    process.env.CURSOR_AGENT_STUB_FIXTURE = HAPPY_FIXTURE;
    process.chdir(tmp.dir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    if (prevHome === undefined) delete process.env.CCD_HOME;
    else process.env.CCD_HOME = prevHome;
    if (prevBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = prevBin;
    if (prevFix === undefined) delete process.env.CURSOR_AGENT_STUB_FIXTURE;
    else process.env.CURSOR_AGENT_STUB_FIXTURE = prevFix;
    tmp.cleanup();
  });

  it('runs to completion and records a finished job', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain([
        '--no-git-check',
        '--model',
        'composer',
        '--',
        'hello world task',
      ]);
      expect(code).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }
    const jobs = listJobs(tmp.dir);
    expect(jobs.length).toBe(1);
    const job = jobs[0];
    expect(job.status).toBe('done');
    expect(job.model).toBe('composer-2.5-fast');
    expect(job.cursorChatId).toBe('chat_abc123');
    expect(job.filesTouched?.length ?? 0).toBeGreaterThan(0);
  });

  // Issue C: a foreground run must also drop the completion sentinel — not
  // just the background worker path.
  it('writes a completion sentinel once the foreground job finishes', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let jobId;
    try {
      await delegateMain(['--no-git-check', '--model', 'composer', '--', 'hello world task']);
      jobId = listJobs(tmp.dir)[0].id;
    } finally {
      writeSpy.mockRestore();
    }
    expect(jobId).toBeTruthy();
    expect(existsSync(jobDonePath(tmp.dir, jobId))).toBe(true);
  });

  // Issue D: progress lines show "tool → file" for a write-like tool with an
  // extractable path, not just a bare tool name.
  it('progress output includes the touched file, not just the tool name', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let lines;
    try {
      await delegateMain(['--no-git-check', '--model', 'composer', '--', 'hello world task']);
      // Read the recorded calls before mockRestore() — it clears mock.calls.
      lines = writeSpy.mock.calls.map((c) => String(c[0]));
    } finally {
      writeSpy.mockRestore();
    }
    expect(lines.some((l) => l.startsWith('• write → src/foo.ts'))).toBe(true);
    expect(lines.some((l) => l.startsWith('• edit → README.md'))).toBe(true);
  });

  // A task containing a bare `--` used to swallow every following flag, so the
  // run silently used the default model while still reporting success.
  it('honours --model even when the task text contains a bare --', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let lines;
    try {
      const code = await delegateMain([
        '--no-git-check',
        '--model',
        'composer',
        '--',
        'fix the bug -- see notes',
      ]);
      expect(code).toBe(0);
      lines = writeSpy.mock.calls.map((c) => String(c[0]));
    } finally {
      writeSpy.mockRestore();
    }
    const job = listJobs(tmp.dir)[0];
    expect(job.model).toBe('composer-2.5-fast');
    // The `--` is part of the task, so it must survive into the prompt.
    expect(job.prompt).toBe('fix the bug -- see notes');
    // And the result block must state which model actually ran.
    expect(lines.some((l) => l.includes('**Model:** composer-2.5-fast'))).toBe(true);
  });

  // Issue F: when the caller asked for `auto`, the job record should end up
  // with the concrete model id the stream reveals Cursor actually ran with,
  // not the literal placeholder "auto".
  it('records the concrete resolved model instead of leaving "auto"', async () => {
    process.env.CURSOR_AGENT_STUB_FIXTURE = NESTED_TOOL_USE_FIXTURE;
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain(['--no-git-check', '--', 'hello world task']);
      expect(code).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }
    const job = listJobs(tmp.dir)[0];
    expect(job.model).toBe('claude-4.6-sonnet-medium');
  });

  it('refuses outside a git repo without --no-git-check', async () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain(['--', 'nope']);
      expect(code).toBe(2);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('errors with exit 2 when no prompt is given', async () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain(['--no-git-check']);
      expect(code).toBe(2);
    } finally {
      errSpy.mockRestore();
    }
  });

  // --prompt-file lets a long, multi-line, quote-heavy prompt reach the job
  // without CLI-arg mangling. The recorded job prompt must equal the file's
  // (trimmed) contents verbatim.
  it('reads the task from --prompt-file and records it verbatim', async () => {
    const spec = `Goal: refactor the "widget" module.\nConstraints: keep $env vars & \`backticks\`.\n`;
    const specPath = join(tmp.dir, 'spec.md');
    writeFileSync(specPath, spec, 'utf8');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      // Flags/paths go before `--` so they stay verbatim tokens — the temp path
      // contains a space, which the post-`--` re-splitter would otherwise break.
      const code = await delegateMain(['--no-git-check', '--prompt-file', specPath, '--']);
      expect(code).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }
    const jobs = listJobs(tmp.dir);
    expect(jobs.length).toBe(1);
    expect(jobs[0].prompt).toBe(spec.trim());
  });

  it('rejects a task given both on the command line and via --prompt-file', async () => {
    const specPath = join(tmp.dir, 'spec.md');
    writeFileSync(specPath, 'from file', 'utf8');
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain([
        '--no-git-check',
        '--prompt-file',
        specPath,
        '--',
        'from cli',
      ]);
      expect(code).toBe(2);
    } finally {
      errSpy.mockRestore();
    }
    expect(listJobs(tmp.dir).length).toBe(0);
  });

  it('exits 2 when --prompt-file points at a missing file', async () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let errOut = '';
    try {
      const code = await delegateMain([
        '--no-git-check',
        '--prompt-file',
        join(tmp.dir, 'does-not-exist.md'),
        '--',
      ]);
      expect(code).toBe(2);
      errOut = errSpy.mock.calls.map((c) => String(c[0])).join('');
    } finally {
      errSpy.mockRestore();
    }
    expect(errOut).toContain('prompt file not found');
    expect(listJobs(tmp.dir).length).toBe(0);
  });

  it('exits 2 when --prompt-file is an empty file', async () => {
    const specPath = join(tmp.dir, 'empty.md');
    writeFileSync(specPath, '   \n\t ', 'utf8');
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain(['--no-git-check', '--prompt-file', specPath, '--']);
      expect(code).toBe(2);
    } finally {
      errSpy.mockRestore();
    }
    expect(listJobs(tmp.dir).length).toBe(0);
  });

  // Regression: a numeric `--resume=<id>` used to crash with
  // `resume.trim is not a function` because the parser auto-cast it to a number.
  it('does not crash on a numeric --resume id', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain(['--no-git-check', '--resume=12345', '--', 'follow up']);
      expect(code).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }
    expect(listJobs(tmp.dir).length).toBe(1);
  });

  // Regression: `/cursor:resume <multi-word prompt>` used to send the first
  // prompt word as the chat-id because `--resume` greedily consumed it.
  it('resume.mjs preserves a multi-word non-ASCII prompt', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await resumeMain(['--no-git-check', '--', 'řekni mi něco o teto službě']);
      expect(code).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }
    const jobs = listJobs(tmp.dir);
    expect(jobs.length).toBe(1);
    expect(jobs[0].prompt).toBe('řekni mi něco o teto službě');
  });
});

// Issue A: the id `/cursor:delegate` prints to the caller must be the exact
// id `/cursor:status` and `/cursor:result` accept, and a completed job with
// that id must be reliably retrievable through both — not just the flow
// under test above, but each real entrypoint script.
describe('delegate → status/result id retrieval (issue A)', () => {
  let tmp;
  const prevHome = process.env.CCD_HOME;
  const prevBin = process.env.CURSOR_AGENT_BIN;
  const prevFix = process.env.CURSOR_AGENT_STUB_FIXTURE;
  const prevCwd = process.cwd();

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CCD_HOME = tmp.dir;
    process.env.CURSOR_AGENT_BIN = STUB_BIN;
    process.env.CURSOR_AGENT_STUB_FIXTURE = HAPPY_FIXTURE;
    process.chdir(tmp.dir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    if (prevHome === undefined) delete process.env.CCD_HOME;
    else process.env.CCD_HOME = prevHome;
    if (prevBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = prevBin;
    if (prevFix === undefined) delete process.env.CURSOR_AGENT_STUB_FIXTURE;
    else process.env.CURSOR_AGENT_STUB_FIXTURE = prevFix;
    tmp.cleanup();
  });

  function capturedJobId(writeSpy) {
    for (const call of writeSpy.mock.calls) {
      const text = String(call[0]);
      const match = text.match(/Job `([^`]+)`/);
      if (match) return match[1];
    }
    return undefined;
  }

  it('a foreground job is found by status/result using the id delegate printed', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let jobId;
    try {
      await delegateMain(['--no-git-check', '--model', 'composer', '--', 'a task']);
      jobId = capturedJobId(writeSpy);
    } finally {
      writeSpy.mockRestore();
    }
    expect(jobId).toBeTruthy();

    const statusSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let statusOut = '';
    try {
      const code = await statusMain([jobId]);
      expect(code).toBe(0);
      statusOut = statusSpy.mock.calls.map((c) => String(c[0])).join('');
    } finally {
      statusSpy.mockRestore();
    }
    expect(statusOut).toContain('done');

    const resultSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let resultOut = '';
    try {
      const code = await resultMain([jobId]);
      expect(code).toBe(0);
      resultOut = resultSpy.mock.calls.map((c) => String(c[0])).join('');
    } finally {
      resultSpy.mockRestore();
    }
    expect(resultOut).toContain('done');
    expect(resultOut).toContain(`\`${jobId}\``);
  });

  it('a background job reaches "done" and is found by status/result using the launch id', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let jobId;
    try {
      const code = await delegateMain([
        '--background',
        '--no-git-check',
        '--model',
        'composer',
        '--',
        'a background task',
      ]);
      expect(code).toBe(0);
      jobId = capturedJobId(writeSpy);
    } finally {
      writeSpy.mockRestore();
    }
    expect(jobId).toBeTruthy();

    // The background worker is a real detached child process — poll until it
    // finishes instead of assuming a fixed delay.
    const deadline = Date.now() + 10_000;
    let job = readJob(tmp.dir, jobId);
    while ((!job || job.status === 'running') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      job = readJob(tmp.dir, jobId);
    }
    expect(job?.status).toBe('done');
    expect(existsSync(jobDonePath(tmp.dir, jobId))).toBe(true);

    const resultSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let resultOut = '';
    try {
      const code = await resultMain([jobId]);
      expect(code).toBe(0);
      resultOut = resultSpy.mock.calls.map((c) => String(c[0])).join('');
    } finally {
      resultSpy.mockRestore();
    }
    expect(resultOut).toContain(`\`${jobId}\``);
    expect(resultOut).toContain('done');
  }, 15_000);
});
