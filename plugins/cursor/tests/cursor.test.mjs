import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildArgs, resolveModel, runHeadless } from '../scripts/lib/cursor.mjs';
import { extractChatId, summariseEvents } from '../scripts/lib/parse.mjs';
import { HAPPY_FIXTURE, STUB_BIN, makeTempHome } from './helpers.mjs';

describe('buildArgs', () => {
  it('includes the expected flags by default', () => {
    const args = buildArgs({ prompt: 'hi', model: 'composer-2.5' });
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--trust');
    expect(args).toContain('--model');
    expect(args).toContain('composer-2.5');
    expect(args.at(-1)).toBe('hi');
  });

  it('omits --force when force=false', () => {
    const args = buildArgs({ prompt: 'hi', model: 'auto', force: false });
    expect(args).not.toContain('--force');
  });

  it('adds --cloud and --resume when requested', () => {
    const args = buildArgs({
      prompt: 'hi',
      model: 'auto',
      cloud: true,
      resumeChatId: 'chat_xyz',
    });
    expect(args).toContain('--cloud');
    expect(args).toContain('--resume=chat_xyz');
  });

  it('adds --approve-mcps when requested', () => {
    const args = buildArgs({ prompt: 'hi', model: 'auto', approveMcps: true });
    expect(args).toContain('--approve-mcps');
  });

  it('omits --approve-mcps by default', () => {
    const args = buildArgs({ prompt: 'hi', model: 'auto' });
    expect(args).not.toContain('--approve-mcps');
  });
});

describe('resolveModel', () => {
  const prevDefault = process.env.CCD_DEFAULT_MODEL;
  afterEach(() => {
    if (prevDefault === undefined) delete process.env.CCD_DEFAULT_MODEL;
    else process.env.CCD_DEFAULT_MODEL = prevDefault;
  });

  it('maps the three stable human shortcuts to real Cursor ids', () => {
    expect(resolveModel('composer')).toBe('composer-2.5-fast');
    expect(resolveModel('fast')).toBe('composer-2.5-fast');
    expect(resolveModel('auto')).toBe('auto');
  });

  // MODEL_ALIASES intentionally no longer hardcodes per-vendor ids (they went
  // stale within weeks). Anything outside the three stable shortcuts —
  // including ids that used to be aliased, and retired/future ids — must
  // pass through verbatim. This IS the future-proofing.
  it('passes every non-shortcut id through verbatim, aliased or not', () => {
    expect(resolveModel('composer-2.5')).toBe('composer-2.5');
    expect(resolveModel('composer-2.5-fast')).toBe('composer-2.5-fast');
    expect(resolveModel('composer-full')).toBe('composer-full');
    expect(resolveModel('sonnet')).toBe('sonnet');
    expect(resolveModel('opus')).toBe('opus');
    expect(resolveModel('gpt')).toBe('gpt');
    expect(resolveModel('grok')).toBe('grok');
    expect(resolveModel('gemini')).toBe('gemini');
    expect(resolveModel('claude-opus-4-7-high')).toBe('claude-opus-4-7-high');
    expect(resolveModel('some-brand-new-model-id')).toBe('some-brand-new-model-id');
  });

  it('defaults to auto when empty (no env override)', () => {
    delete process.env.CCD_DEFAULT_MODEL;
    expect(resolveModel(undefined)).toBe('auto');
    expect(resolveModel('')).toBe('auto');
  });

  it('honours CCD_DEFAULT_MODEL when no input is given', () => {
    process.env.CCD_DEFAULT_MODEL = 'composer';
    expect(resolveModel(undefined)).toBe('composer-2.5-fast');
    process.env.CCD_DEFAULT_MODEL = 'some-custom-id';
    expect(resolveModel('')).toBe('some-custom-id');
  });

  it('explicit input wins over the env default', () => {
    process.env.CCD_DEFAULT_MODEL = 'composer';
    expect(resolveModel('some-explicit-id')).toBe('some-explicit-id');
  });

  it('passes unknown ids through unchanged', () => {
    expect(resolveModel('some-new-model')).toBe('some-new-model');
  });
});

describe('runHeadless against stub binary', () => {
  let tmp;
  const prevBin = process.env.CURSOR_AGENT_BIN;
  const prevFixture = process.env.CURSOR_AGENT_STUB_FIXTURE;

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CURSOR_AGENT_BIN = STUB_BIN;
    process.env.CURSOR_AGENT_STUB_FIXTURE = HAPPY_FIXTURE;
  });

  afterEach(() => {
    if (prevBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = prevBin;
    if (prevFixture === undefined) delete process.env.CURSOR_AGENT_STUB_FIXTURE;
    else process.env.CURSOR_AGENT_STUB_FIXTURE = prevFixture;
    tmp.cleanup();
  });

  it('streams events and writes raw log', async () => {
    const logPath = `${tmp.dir}/run.ndjson`;
    const result = await runHeadless({
      prompt: 'hi',
      model: 'composer-2.5',
      force: false,
      logPath,
      timeoutSec: 10,
    });
    expect(result.exitCode).toBe(0);
    expect(result.events.length).toBeGreaterThan(0);
    const raw = readFileSync(logPath, 'utf8');
    expect(raw.split('\n').filter(Boolean).length).toBeGreaterThan(0);
    expect(extractChatId(result.events)).toBe('chat_abc123');
    const summary = summariseEvents(result.events);
    expect(summary.filesTouched.length).toBeGreaterThan(0);
  });
});
