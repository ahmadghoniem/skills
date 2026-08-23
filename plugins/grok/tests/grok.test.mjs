import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HAPPY_FIXTURE, STUB_BIN, makeTempHome } from './helpers.mjs';

const REAL_MODELS_STDOUT = [
  'You are not authenticated.',
  '',
  'Available models:',
  '  * grok-4.6 (default)',
  '  - grok-4.5',
  '',
].join('\n');

describe('model list helpers', () => {
  it('parseModelList keeps ids and drops headings, tips, and the auth preamble', async () => {
    const { parseModelList } = await import('../scripts/lib/grok.mjs');
    expect(parseModelList(REAL_MODELS_STDOUT)).toEqual(['grok-4.6', 'grok-4.5']);
  });

  it('modelRank prefers a newer x.y id and sends unparseable ids last', async () => {
    const { modelRank } = await import('../scripts/lib/grok.mjs');
    expect(modelRank('grok-4.6')).toBe(40006);
    expect(modelRank('grok-4.5')).toBe(40005);
    expect(modelRank('grok-4.6') > modelRank('grok-4.5')).toBe(true);
    expect(modelRank('auto')).toBe(-1);
    expect(modelRank('grok-4.6') > modelRank('auto')).toBe(true);
  });
});

describe('buildArgs', () => {
  it('always includes --always-approve and --no-auto-update', async () => {
    const { buildArgs } = await import('../scripts/lib/grok.mjs');
    const args = buildArgs({ promptFile: '/tmp/brief.md', model: 'grok-4.6' });
    expect(args).toContain('--always-approve');
    expect(args).toContain('--no-auto-update');
    expect(args).toContain('--prompt-file');
    expect(args).toContain('/tmp/brief.md');
    expect(args).toContain('streaming-json');
    expect(args).toContain('-m');
    expect(args).toContain('grok-4.6');
    expect(args).not.toContain('--reasoning-effort');
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--continue');
  });

  it('adds --reasoning-effort only when an effort was given', async () => {
    const { buildArgs } = await import('../scripts/lib/grok.mjs');
    const withEffort = buildArgs({
      promptFile: '/tmp/brief.md',
      model: 'grok-4.6',
      effort: 'high',
    });
    expect(withEffort).toContain('--reasoning-effort');
    expect(withEffort).toContain('high');
    const without = buildArgs({ promptFile: '/tmp/brief.md', model: 'grok-4.6' });
    expect(without).not.toContain('--reasoning-effort');
  });

  it('--resume <id> and --continue are mutually exclusive', async () => {
    const { buildArgs } = await import('../scripts/lib/grok.mjs');
    const resume = buildArgs({
      promptFile: '/tmp/brief.md',
      model: 'grok-4.6',
      resumeSessionId: 'sess_abc',
      resumeLatest: true,
    });
    expect(resume).toContain('--resume');
    expect(resume).toContain('sess_abc');
    expect(resume).not.toContain('--continue');

    const cont = buildArgs({
      promptFile: '/tmp/brief.md',
      model: 'grok-4.6',
      resumeLatest: true,
    });
    expect(cont).toContain('--continue');
    expect(cont).not.toContain('--resume');
  });
});

describe('resolveModel', () => {
  let tmp;
  const prevHome = process.env.CGD_HOME;
  const prevBin = process.env.GROK_BIN;
  const prevDefault = process.env.CGD_DEFAULT_MODEL;
  const prevFail = process.env.GROK_STUB_FAIL;

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CGD_HOME = tmp.dir;
    process.env.GROK_BIN = STUB_BIN;
    delete process.env.CGD_DEFAULT_MODEL;
    delete process.env.GROK_STUB_FAIL;
    vi.resetModules();
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CGD_HOME;
    else process.env.CGD_HOME = prevHome;
    if (prevBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = prevBin;
    if (prevDefault === undefined) delete process.env.CGD_DEFAULT_MODEL;
    else process.env.CGD_DEFAULT_MODEL = prevDefault;
    if (prevFail === undefined) delete process.env.GROK_STUB_FAIL;
    else process.env.GROK_STUB_FAIL = prevFail;
    tmp.cleanup();
  });

  it('returns an explicit id verbatim', async () => {
    const { resolveModel } = await import('../scripts/lib/grok.mjs');
    expect(await resolveModel('grok-4.5')).toBe('grok-4.5');
    expect(await resolveModel(' some-custom-id ')).toBe('some-custom-id');
  });

  it('honours CGD_DEFAULT_MODEL when no input is given', async () => {
    process.env.CGD_DEFAULT_MODEL = 'grok-4.5';
    const { resolveModel } = await import('../scripts/lib/grok.mjs');
    expect(await resolveModel(undefined)).toBe('grok-4.5');
    expect(await resolveModel('')).toBe('grok-4.5');
  });

  it('explicit input wins over the env default', async () => {
    process.env.CGD_DEFAULT_MODEL = 'grok-4.5';
    const { resolveModel } = await import('../scripts/lib/grok.mjs');
    expect(await resolveModel('grok-4.6')).toBe('grok-4.6');
  });

  it('asks the stub and picks the newest id when the cache is cold', async () => {
    const { resolveModel, FALLBACK_MODEL } = await import('../scripts/lib/grok.mjs');
    expect(FALLBACK_MODEL).toBe('grok-4.6');
    expect(await resolveModel(undefined)).toBe('grok-4.6');
  });

  it('falls back to the pinned id when the cache is cold and the stub fails', async () => {
    process.env.GROK_STUB_FAIL = '1';
    const { resolveModel, FALLBACK_MODEL } = await import('../scripts/lib/grok.mjs');
    expect(await resolveModel(undefined)).toBe(FALLBACK_MODEL);
  });
});

describe('runHeadless against stub binary', () => {
  let tmp;
  const prevHome = process.env.CGD_HOME;
  const prevBin = process.env.GROK_BIN;
  const prevFixture = process.env.GROK_STUB_FIXTURE;

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CGD_HOME = tmp.dir;
    process.env.GROK_BIN = STUB_BIN;
    process.env.GROK_STUB_FIXTURE = HAPPY_FIXTURE;
    vi.resetModules();
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CGD_HOME;
    else process.env.CGD_HOME = prevHome;
    if (prevBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = prevBin;
    if (prevFixture === undefined) delete process.env.GROK_STUB_FIXTURE;
    else process.env.GROK_STUB_FIXTURE = prevFixture;
    tmp.cleanup();
  });

  it('streams events and writes the raw log without invoking the real grok binary', async () => {
    const { runHeadless } = await import('../scripts/lib/grok.mjs');
    const { summariseEvents } = await import('../scripts/lib/parse.mjs');
    const logPath = `${tmp.dir}/run.ndjson`;
    const result = await runHeadless({
      prompt: 'hi',
      model: 'grok-4.6',
      logPath,
      timeoutSec: 10,
    });
    expect(result.exitCode).toBe(0);
    expect(result.events.length).toBeGreaterThan(0);
    const raw = readFileSync(logPath, 'utf8');
    expect(raw.split('\n').filter(Boolean).length).toBeGreaterThan(0);
    const summary = summariseEvents(result.events);
    expect(summary.success).toBe(true);
    expect(summary.sessionId).toBe('01a02e4d-8d55-73f2-a26b-046282b9097d');
  });
});
