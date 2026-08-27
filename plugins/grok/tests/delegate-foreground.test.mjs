import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../scripts/delegate.mjs';
import { readJob } from '../scripts/lib/jobs.mjs';
import { HAPPY_FIXTURE, STUB_BIN, makeTempHome } from './helpers.mjs';

// There is one run path now — `main` → `foreground` → `runAndRecord` — so this
// is the only test that walks it end to end. It replaces the worker test that
// went with `--background`, and it exists because the path had gone untested:
// `foreground` read `freshSessionId`, a const scoped to `runAndRecord`, which
// threw a ReferenceError while rendering the outcome of every completed run.
describe('/grok:delegate foreground run', () => {
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

  // `--help` used to fall through to a real, billed dispatch.
  it('prints usage and runs nothing on --help, even behind the injected --resume', async () => {
    expect(await main(['--resume', '--help'])).toBe(0);
    expect(out).toContain('Usage: /grok:delegate');
    expect(out).not.toContain('grok `');
  });

  it('runs, records the job, and renders the write-up without throwing', async () => {
    const code = await main(['--no-git-check', '--timeout', '15', 'do the thing']);
    expect(code).toBe(0);

    const id = /grok `([^`]+)`/.exec(out)?.[1];
    expect(id).toBeTruthy();

    const job = readJob(tmp.dir, id);
    expect(job?.status).toBe('done');
    expect(job?.cliPid).toEqual(expect.any(Number));
    expect(readFileSync(`${job.rawLogPath}.prompt.txt`, 'utf8')).toBe('do the thing');
  });

  it('pre-assigns a session id before grok is spawned, so the job is resumable', async () => {
    await main(['--no-git-check', '--timeout', '15', 'do the thing']);
    const id = /grok `([^`]+)`/.exec(out)?.[1];
    expect(readJob(tmp.dir, id)?.grokSessionId).toEqual(expect.any(String));
  });

  // The collision this exists to stop: two Claude sessions in one directory
  // share a job store, so "resume the newest" attached to whichever session
  // dispatched last and answered from a conversation the caller never had —
  // at exit 0, with no warning.
  it('refuses a bare --resume rather than guessing which session was meant', async () => {
    expect(await main(['--no-git-check', '--resume', 'follow up'])).toBe(2);
    expect(err).toContain('--resume needs a job id');
    expect(err).toContain('--resume=<job-id>');
    expect(out).not.toContain('grok `');
  });

  it('translates a job id into the session it recorded', async () => {
    await main(['--no-git-check', '--timeout', '15', 'do the thing']);
    const id = /grok `([^`]+)`/.exec(out)?.[1];
    const session = readJob(tmp.dir, id)?.grokSessionId;

    out = '';
    expect(await main(['--no-git-check', '--timeout', '15', `--resume=${id}`, 'and again'])).toBe(0);
    const second = /grok `([^`]+)`/.exec(out)?.[1];
    expect(second).not.toBe(id);
    expect(readJob(tmp.dir, second)?.grokSessionId).toBe(session);
  });

  it('rejects a --resume id that matches no job', async () => {
    expect(await main(['--no-git-check', '--resume=notarealjobid', 'x'])).toBe(2);
    expect(err).toContain('No job');
    expect(out).not.toContain('grok `');
  });

  // The killed branch is the one that reads `freshSessionId`; a clean run
  // short-circuits past it, which is why the scope bug survived. Keep this
  // asserting on the rendered line, not just on the exit code.
  it('offers the pre-assigned session when the watchdog kills the run', async () => {
    process.env.GROK_STUB_HANG = '1';
    try {
      await main(['--no-git-check', '--timeout', '1', 'do the thing']);
    } finally {
      delete process.env.GROK_STUB_HANG;
    }
    expect(out).toContain('⚠ run was killed before finishing');
    const jobId = /grok `([^`]+)`/.exec(out)?.[1];
    expect(out).toContain(`/grok:resume --resume=${jobId}`);
    expect(out).not.toContain('cannot be resumed');
  });
});
