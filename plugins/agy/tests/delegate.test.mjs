// Integration tests for delegate.mjs's `main`, run against the stubbed agy
// binary (never the real CLI) so the never-started rule, the resume offer,
// and the exit code are exercised through the real dispatch path rather than
// re-implemented against a mock.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_STDIN_CHARS, resetBinCache, writeModelCache } from '../scripts/lib/agy.mjs';
import { listJobs } from '../scripts/lib/jobs.mjs';
import { STUB_BIN } from './helpers.mjs';

const prevHome = process.env.CAD_HOME;
const prevBin = process.env.AGY_BIN;
const prevFixture = process.env.AGY_STUB_FIXTURE;
const prevExit = process.env.AGY_STUB_EXIT;
const prevCwd = process.cwd();

let home;
let repo;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cad-delegate-'));
  repo = mkdtempSync(join(tmpdir(), 'cad-delegate-repo-'));
  process.env.CAD_HOME = home;
  process.env.AGY_BIN = STUB_BIN;
  process.chdir(repo);
  resetBinCache();
});

afterEach(() => {
  process.chdir(prevCwd);
  if (prevHome === undefined) delete process.env.CAD_HOME;
  else process.env.CAD_HOME = prevHome;
  if (prevBin === undefined) delete process.env.AGY_BIN;
  else process.env.AGY_BIN = prevBin;
  if (prevFixture === undefined) delete process.env.AGY_STUB_FIXTURE;
  else process.env.AGY_STUB_FIXTURE = prevFixture;
  if (prevExit === undefined) delete process.env.AGY_STUB_EXIT;
  else process.env.AGY_STUB_EXIT = prevExit;
  resetBinCache();
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

/** A fixture the stub replays: one `result` event, no `init`. */
function writeFixture(dir, name, resultObj) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify({ event: 'result', result: resultObj })}\n`, 'utf8');
  return path;
}

describe('delegate.mjs: never-started runs', () => {
  it('records status ERROR with no conversation id as failed, and exits non-zero', async () => {
    const { main } = await import('../scripts/delegate.mjs');
    const fixture = writeFixture(home, 'never-started.ndjson', {
      status: 'ERROR',
      response: '',
      error: 'invalid model selection (--model "not-a-model" --effort ""): model not recognized',
    });
    process.env.AGY_STUB_FIXTURE = fixture;
    process.env.AGY_STUB_EXIT = '1';

    const code = await main(['a task that never gets going']);

    const [job] = listJobs(repo);
    expect(job.status).toBe('failed');
    expect(job.agyStatus).toBe('ERROR');
    expect(job.conversationId).toBeUndefined();
    expect(code).toBe(1);
  });

  it('does not mark a finished ERROR run (with a conversation id) as never-started', async () => {
    const { main } = await import('../scripts/delegate.mjs');
    const fixture = writeFixture(home, 'error-but-going.ndjson', {
      status: 'ERROR',
      conversation_id: 'c0ffee00-0000-4000-8000-000000000000',
      response: 'did some of it',
      error: 'refused write',
    });
    process.env.AGY_STUB_FIXTURE = fixture;
    process.env.AGY_STUB_EXIT = '0';

    await main(['a task that gets partway']);

    const [job] = listJobs(repo);
    expect(job.status).toBe('done');
    expect(job.conversationId).toBe('c0ffee00-0000-4000-8000-000000000000');
  });
});

describe('delegate.mjs: exit code', () => {
  it('exits non-zero when agy status is ERROR, even with exit 0 and a write-up', async () => {
    const { main } = await import('../scripts/delegate.mjs');
    const fixture = writeFixture(home, 'dropped.ndjson', {
      status: 'ERROR',
      conversation_id: 'c0ffee00-0000-4000-8000-000000000001',
      response: 'got partway',
      error: 'no such host',
    });
    process.env.AGY_STUB_FIXTURE = fixture;
    process.env.AGY_STUB_EXIT = '0';

    const code = await main(['a task that drops mid-run']);

    expect(code).toBe(1);
  });

  it('exits zero on a clean run', async () => {
    const { main } = await import('../scripts/delegate.mjs');
    const fixture = writeFixture(home, 'clean.ndjson', {
      status: 'SUCCESS',
      conversation_id: 'c0ffee00-0000-4000-8000-000000000002',
      response: 'all done',
    });
    process.env.AGY_STUB_FIXTURE = fixture;
    process.env.AGY_STUB_EXIT = '0';

    const code = await main(['a task that finishes cleanly']);
    expect(code).toBe(0);
  });
});

describe('delegate.mjs: --prompt-file', () => {
  it('dispatches the content of the file as the prompt', async () => {
    const { main } = await import('../scripts/delegate.mjs');
    const fixture = writeFixture(home, 'from-file.ndjson', {
      status: 'SUCCESS',
      conversation_id: 'c0ffee00-0000-4000-8000-000000000003',
      response: 'read the brief and did it',
    });
    process.env.AGY_STUB_FIXTURE = fixture;
    process.env.AGY_STUB_EXIT = '0';

    const briefPath = join(repo, 'brief.md');
    writeFileSync(briefPath, 'Fix the off-by-one in src/range.mjs.\n', 'utf8');

    const code = await main(['--prompt-file', briefPath]);

    expect(code).toBe(0);
    const [job] = listJobs(repo);
    expect(job.prompt).toBe('Fix the off-by-one in src/range.mjs.');
    expect(job.briefPath).toBe(briefPath);
  });

  it('errors when both a positional task and --prompt-file are given', async () => {
    const { main } = await import('../scripts/delegate.mjs');
    const briefPath = join(repo, 'brief.md');
    writeFileSync(briefPath, 'Do the thing.\n', 'utf8');

    const code = await main(['--prompt-file', briefPath, 'also a task on the command line']);

    expect(code).toBe(2);
    expect(listJobs(repo)).toHaveLength(0);
  });

  it('errors clearly when the prompt file cannot be read', async () => {
    const { main } = await import('../scripts/delegate.mjs');
    const missingPath = join(repo, 'does-not-exist.md');

    const code = await main(['--prompt-file', missingPath]);

    expect(code).toBe(2);
    expect(listJobs(repo)).toHaveLength(0);
  });
});

describe('delegate.mjs: the message agy receives', () => {
  /** Run one dispatch and return [argv, stdin text] as the stub saw them. */
  async function dispatch(argv) {
    const { main } = await import('../scripts/delegate.mjs');
    // A fresh cache, so no `agy models` refresh overwrites the dumped argv.
    writeModelCache([{ id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' }], null, '1.2.11', STUB_BIN);
    process.env.AGY_STUB_FIXTURE = writeFixture(home, 'ok.ndjson', {
      status: 'SUCCESS',
      conversation_id: 'c0ffee00-0000-4000-8000-000000000000',
      response: 'done',
    });
    process.env.AGY_STUB_ARGV = join(home, 'argv.json');
    process.env.AGY_STUB_STDIN = join(home, 'stdin.txt');
    try {
      await main(argv);
    } finally {
      delete process.env.AGY_STUB_ARGV;
      delete process.env.AGY_STUB_STDIN;
    }
    const args = JSON.parse(readFileSync(join(home, 'argv.json'), 'utf8'));
    let stdin = null;
    try {
      stdin = readFileSync(join(home, 'stdin.txt'), 'utf8');
    } catch {
      // no stdin read
    }
    return [args, stdin];
  }

  it('sends the environment note, AGENTS.md and the task on stdin', async () => {
    writeFileSync(join(repo, 'AGENTS.md'), 'agents rules', 'utf8');
    writeFileSync(join(repo, 'CLAUDE.md'), 'claude rules', 'utf8');
    const [args, stdin] = await dispatch(['do the thing']);
    expect(args).toContain('--input-format');
    expect(args).toContain('--disable-slash-commands');
    const { content } = JSON.parse(stdin).message;
    expect(content).toMatch(/^Environment\n- Working directory: .+\n- Git repository: no\n/);
    expect(content).toContain('# Repository rules (AGENTS.md), which you follow\n\nagents rules');
    expect(content).not.toContain('claude rules');
    expect(content.endsWith('# Task\n\ndo the thing')).toBe(true);
  });

  it('falls back to CLAUDE.md when AGENTS.md is missing or empty', async () => {
    writeFileSync(join(repo, 'AGENTS.md'), '\n', 'utf8');
    writeFileSync(join(repo, 'CLAUDE.md'), 'claude rules', 'utf8');
    const [, stdin] = await dispatch(['do the thing']);
    expect(JSON.parse(stdin).message.content).toContain('# Repository rules (CLAUDE.md), which you follow');
  });

  it('sends only the follow-up on resume', async () => {
    writeFileSync(join(repo, 'AGENTS.md'), 'agents rules', 'utf8');
    const [, stdin] = await dispatch(['--conversation', 'c0ffee00-0000-4000-8000-000000000000', 'and now this']);
    expect(JSON.parse(stdin).message.content).toBe('and now this');
  });

  it('moves a message too long for stdin to the sidecar file', async () => {
    const [args, stdin] = await dispatch(['x'.repeat(MAX_STDIN_CHARS + 1)]);
    expect(stdin).toBe(null);
    expect(args).not.toContain('--input-format');
    expect(args.at(-1)).toMatch(/^--print=Read the file at .+\.prompt\.md in full/);
  });
});
