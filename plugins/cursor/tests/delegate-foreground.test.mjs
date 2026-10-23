import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../scripts/delegate.mjs';
import { readJob } from '../scripts/lib/jobs.mjs';
import { HAPPY_FIXTURE, REFUSED_FIXTURE, STUB_BIN, makeTempHome } from './helpers.mjs';

// The one test that walks the whole run path, `main` → `runAndRecord` →
// `renderResult`, against the stub binary.
describe('/cursor:delegate', () => {
  let tmp;
  const prevHome = process.env.CCD_HOME;
  const prevBin = process.env.CURSOR_AGENT_BIN;
  const prevFixture = process.env.CURSOR_AGENT_STUB_FIXTURE;
  const prevCwd = process.cwd();
  let out;
  let err;

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CCD_HOME = tmp.dir;
    process.env.CURSOR_AGENT_BIN = STUB_BIN;
    process.env.CURSOR_AGENT_STUB_FIXTURE = HAPPY_FIXTURE;
    process.chdir(tmp.dir);
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out += s;
      return true;
    });
    err = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
      err += s;
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(prevCwd);
    if (prevHome === undefined) delete process.env.CCD_HOME;
    else process.env.CCD_HOME = prevHome;
    if (prevBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = prevBin;
    if (prevFixture === undefined) delete process.env.CURSOR_AGENT_STUB_FIXTURE;
    else process.env.CURSOR_AGENT_STUB_FIXTURE = prevFixture;
    tmp.cleanup();
  });

  const jobIdIn = (text) => /cursor `([^`]+)`/.exec(text)?.[1];

  it('prints usage and runs nothing on --help', async () => {
    expect(await main(['--help'])).toBe(0);
    expect(out).toContain('Usage: /cursor:delegate');
    expect(out).not.toContain('cursor `');
  });

  it('refuses a dispatch with no task', async () => {
    expect(await main([])).toBe(2);
    expect(err).toContain('no task description');
  });

  it('runs, records the job under a name taken from the task, and renders the write-up', async () => {
    const code = await main(['--timeout', '15', 'do the thing']);
    expect(code).toBe(0);

    const id = jobIdIn(out);
    expect(id).toMatch(/^do-the-thing-[0-9a-z]{4}$/);

    const job = readJob(tmp.dir, id);
    expect(job?.status).toBe('done');
    expect(job?.cliPid).toEqual(expect.any(Number));
    expect(readFileSync(`${job.rawLogPath}.prompt.txt`, 'utf8')).toBe('do the thing');
    expect(out).not.toContain('⚠');
  });

  it('reads the brief from --prompt-file', async () => {
    const brief = `${tmp.dir}/brief.md`;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(brief, '## Goal\nAdd divide.\n', 'utf8');
    expect(await main(['--timeout', '15', '--prompt-file', brief])).toBe(0);
    const job = readJob(tmp.dir, jobIdIn(out));
    expect(job?.briefPath).toBe(brief);
    expect(readFileSync(`${job.rawLogPath}.prompt.txt`, 'utf8')).toBe('## Goal\nAdd divide.');
  });

  it('pre-assigns a chat id and passes no --model unless one was named', async () => {
    const argvOut = `${tmp.dir}/argv.json`;
    process.env.CURSOR_AGENT_STUB_ARGV_OUT = argvOut;
    try {
      await main(['--timeout', '15', 'do the thing']);
    } finally {
      delete process.env.CURSOR_AGENT_STUB_ARGV_OUT;
    }
    const chatId = readJob(tmp.dir, jobIdIn(out))?.chatId;
    expect(chatId).toMatch(/^[0-9a-f-]{36}$/);
    const argv = JSON.parse(readFileSync(argvOut, 'utf8'));
    expect(argv[argv.indexOf('--new-session-id') + 1]).toBe(chatId);
    expect(argv).not.toContain('--model');
  });

  it('continues the named chat with --session', async () => {
    const session = '11111111-2222-3333-4444-555555555555';
    expect(await main(['--timeout', '15', '--session', session, 'and again'])).toBe(0);
    expect(readJob(tmp.dir, jobIdIn(out))?.chatId).toBe(session);
  });

  it('offers a resume and exits 1 when the watchdog kills a started run', async () => {
    process.env.CURSOR_AGENT_STUB_HANG = '1';
    let code;
    try {
      code = await main(['--timeout', '1', 'do the thing']);
    } finally {
      delete process.env.CURSOR_AGENT_STUB_HANG;
    }
    expect(code).toBe(1);
    expect(out).toContain('⚠ run was killed before finishing');
    expect(out).toContain(`/cursor:resume ${jobIdIn(out)}`);
  });

  // A model the Free plan does not allow: cursor-agent sends `system` and
  // `user`, then exits 1 with the reason on stderr. The reason reaches the
  // `⚠ error:` line verbatim, and there is no chat to resume.
  it('passes the plan refusal through verbatim', async () => {
    const reason =
      'ActionRequiredError: Named models unavailable Free plans can only use Auto. Switch to Auto or upgrade plans to continue.';
    process.env.CURSOR_AGENT_STUB_FIXTURE = REFUSED_FIXTURE;
    process.env.CURSOR_AGENT_STUB_STDERR = reason;
    process.env.CURSOR_AGENT_STUB_EXIT = '1';
    let code;
    try {
      code = await main(['--model', 'grok-4.7', 'do the thing']);
    } finally {
      delete process.env.CURSOR_AGENT_STUB_STDERR;
      delete process.env.CURSOR_AGENT_STUB_EXIT;
    }
    expect(code).toBe(1);
    expect(out).toContain(`⚠ error: ${reason}`);
    expect(out).not.toContain('/cursor:resume');
    const job = readJob(tmp.dir, jobIdIn(out));
    expect(job?.status).toBe('failed');
    expect(job?.chatId).toBeUndefined();
  });

  // cursor-agent refused before starting (the stub exits 1 with nothing on
  // stdout, as a rejected flag does), so there is nothing to resume.
  it('reports a refused run with its error and offers no resume', async () => {
    process.env.CURSOR_AGENT_STUB_FAIL = '1';
    let code;
    try {
      code = await main(['--timeout', '15', 'do the thing']);
    } finally {
      delete process.env.CURSOR_AGENT_STUB_FAIL;
    }
    expect(code).toBe(1);
    expect(out).toContain('⚠ exit 1');
    expect(out).toContain('⚠ error: stub: forced failure');
    expect(out).not.toContain('/cursor:resume');
    expect(readJob(tmp.dir, jobIdIn(out))?.status).toBe('failed');
  });
});
