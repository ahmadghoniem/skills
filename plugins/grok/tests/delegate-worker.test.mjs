import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../scripts/delegate.mjs';
import { createJob, readJob } from '../scripts/lib/jobs.mjs';
import { HAPPY_FIXTURE, STUB_BIN, makeTempHome } from './helpers.mjs';

describe('background worker prompt', () => {
  let tmp;
  const prevHome = process.env.CGD_HOME;
  const prevBin = process.env.GROK_BIN;
  const prevFixture = process.env.GROK_STUB_FIXTURE;
  const prevPrompt = process.env.CGD_PROMPT;
  const prevRoot = process.env.CGD_REPO_ROOT;

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CGD_HOME = tmp.dir;
    process.env.GROK_BIN = STUB_BIN;
    process.env.GROK_STUB_FIXTURE = HAPPY_FIXTURE;
    process.env.CGD_REPO_ROOT = tmp.dir;
    delete process.env.CGD_PROMPT;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CGD_HOME;
    else process.env.CGD_HOME = prevHome;
    if (prevBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = prevBin;
    if (prevFixture === undefined) delete process.env.GROK_STUB_FIXTURE;
    else process.env.GROK_STUB_FIXTURE = prevFixture;
    if (prevPrompt === undefined) delete process.env.CGD_PROMPT;
    else process.env.CGD_PROMPT = prevPrompt;
    if (prevRoot === undefined) delete process.env.CGD_REPO_ROOT;
    else process.env.CGD_REPO_ROOT = prevRoot;
    tmp.cleanup();
  });

  it('reads the prompt from the job record when CGD_PROMPT is unset', async () => {
    createJob({
      id: 'wrk1',
      repoPath: tmp.dir,
      prompt: 'prompt-from-job-json',
      model: 'grok-4.6',
    });
    const code = await main(['--worker', 'wrk1', '--timeout', '15']);
    expect(code).toBe(0);
    const job = readJob(tmp.dir, 'wrk1');
    expect(job?.status).toBe('done');
    expect(job?.cliPid).toEqual(expect.any(Number));
    const promptFile = `${job.rawLogPath}.prompt.txt`;
    expect(readFileSync(promptFile, 'utf8')).toBe('prompt-from-job-json');
  });
});
