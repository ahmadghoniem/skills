import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../scripts/delegate.mjs';
import { readJob } from '../scripts/lib/jobs.mjs';
import { HAPPY_FIXTURE, STUB_BIN, makeTempHome } from './helpers.mjs';

// The one test that walks the whole run path, `main` → `runAndRecord` →
// `renderResult`, against the stub binary.
describe('/grok:delegate', () => {
  let tmp;
  const prevHome = process.env.CGD_HOME;
  const prevBin = process.env.GROK_BIN;
  const prevFixture = process.env.GROK_STUB_FIXTURE;
  const prevCwd = process.cwd();
  let out;
  let err;

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CGD_HOME = tmp.dir;
    process.env.GROK_BIN = STUB_BIN;
    process.env.GROK_STUB_FIXTURE = HAPPY_FIXTURE;
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
    if (prevHome === undefined) delete process.env.CGD_HOME;
    else process.env.CGD_HOME = prevHome;
    if (prevBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = prevBin;
    if (prevFixture === undefined) delete process.env.GROK_STUB_FIXTURE;
    else process.env.GROK_STUB_FIXTURE = prevFixture;
    tmp.cleanup();
  });

  const jobIdIn = (text) => /grok `([^`]+)`/.exec(text)?.[1];

  it('prints usage and runs nothing on --help', async () => {
    expect(await main(['--help'])).toBe(0);
    expect(out).toContain('Usage: /grok:delegate');
    expect(out).not.toContain('grok `');
  });

  it('refuses an effort grok cannot use on this account', async () => {
    expect(await main(['--effort', 'high', 'do the thing'])).toBe(2);
    expect(err).toContain('--effort must be low or medium');
    expect(out).not.toContain('grok `');
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
    expect(job?.effort).toBe('medium');
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

  it('pre-assigns a session id, so the job is resumable', async () => {
    await main(['--timeout', '15', 'do the thing']);
    expect(readJob(tmp.dir, jobIdIn(out))?.grokSessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('continues the named session with --session', async () => {
    const session = '11111111-2222-3333-4444-555555555555';
    expect(await main(['--timeout', '15', '--session', session, 'and again'])).toBe(0);
    expect(readJob(tmp.dir, jobIdIn(out))?.grokSessionId).toBe(session);
  });

  it('offers a resume and exits 1 when the watchdog kills a started run', async () => {
    process.env.GROK_STUB_HANG = '1';
    let code;
    try {
      code = await main(['--timeout', '1', 'do the thing']);
    } finally {
      delete process.env.GROK_STUB_HANG;
    }
    expect(code).toBe(1);
    expect(out).toContain('⚠ run was killed before finishing');
    expect(out).toContain(`/grok:resume ${jobIdIn(out)}`);
  });

  // grok refused before starting a session (the stub exits 1 with nothing on
  // stdout, as a rejected flag does), so there is nothing to resume.
  it('reports a refused run with its error and offers no resume', async () => {
    process.env.GROK_STUB_FAIL = '1';
    let code;
    try {
      code = await main(['--timeout', '15', 'do the thing']);
    } finally {
      delete process.env.GROK_STUB_FAIL;
    }
    expect(code).toBe(1);
    expect(out).toContain('⚠ exit 1');
    expect(out).toContain('⚠ error: stub: forced failure');
    expect(out).not.toContain('/grok:resume');
    expect(readJob(tmp.dir, jobIdIn(out))?.status).toBe('failed');
  });
});
