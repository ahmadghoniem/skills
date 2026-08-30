import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROMPT_INLINE_MAX,
  buildArgs,
  childStillRunning,
  fastVariant,
  isCursorModel,
  parseModelList,
  reapChild,
  resolveModel,
  runHeadless,
} from '../scripts/lib/cursor.mjs';
import { extractChatId, summariseEvents } from '../scripts/lib/parse.mjs';
import { HAPPY_FIXTURE, STUB_BIN, makeTempHome } from './helpers.mjs';

// Trimmed verbatim from real `cursor-agent models` output, keeping one model of
// each shape: Cursor-owned with a fast variant, third-party with one, and
// third-party without.
const MODEL_LIST = [
  'Available models',
  '',
  'auto - Auto (default)',
  'composer-2.5 - Composer 2.5 (current)',
  'composer-2.5-fast - Composer 2.5 Fast',
  'cursor-grok-4.5-high - Cursor Grok 4.5',
  'cursor-grok-4.5-high-fast - Cursor Grok 4.5 Fast',
  'gpt-5.2 - GPT-5.2',
  'gpt-5.2-fast - GPT-5.2 Fast',
  'claude-sonnet-5-high - Sonnet 5 1M',
  'gemini-3.1-pro - Gemini 3.1 Pro',
  '',
  'Tip: use --model <id> to switch.',
];

describe('model list helpers', () => {
  it('parseModelList keeps ids and drops headings and tips', () => {
    expect(parseModelList(MODEL_LIST)).toEqual([
      'auto',
      'composer-2.5',
      'composer-2.5-fast',
      'cursor-grok-4.5-high',
      'cursor-grok-4.5-high-fast',
      'gpt-5.2',
      'gpt-5.2-fast',
      'claude-sonnet-5-high',
      'gemini-3.1-pro',
    ]);
  });

  it('isCursorModel matches Cursor-owned ids by namespace, not version', () => {
    expect(isCursorModel('composer-2.5')).toBe(true);
    expect(isCursorModel('composer-3')).toBe(true);
    expect(isCursorModel('cursor-grok-4.5-high')).toBe(true);
    expect(isCursorModel('cursor-grok-5-low')).toBe(true);
    expect(isCursorModel('gpt-5.2')).toBe(false);
    expect(isCursorModel('claude-sonnet-5-high')).toBe(false);
    expect(isCursorModel('gemini-3.1-pro')).toBe(false);
  });

  it('fastVariant finds a sibling only when the account offers one', () => {
    const ids = parseModelList(MODEL_LIST);
    expect(fastVariant('composer-2.5', ids)).toBe('composer-2.5-fast');
    expect(fastVariant('cursor-grok-4.5-high', ids)).toBe('cursor-grok-4.5-high-fast');
    expect(fastVariant('gpt-5.2', ids)).toBe('gpt-5.2-fast');
    expect(fastVariant('claude-sonnet-5-high', ids)).toBeUndefined();
    expect(fastVariant('gemini-3.1-pro', ids)).toBeUndefined();
    // A fast id has no fast variant of its own.
    expect(fastVariant('composer-2.5-fast', ids)).toBeUndefined();
  });
});

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

  it('keeps a short ordinary prompt inline', () => {
    const args = buildArgs({ prompt: 'fix the flaky test', model: 'auto' });
    expect(args.at(-1)).toBe('fix the flaky test');
  });

  it('routes a long prompt through the sidecar file', () => {
    const tmp = makeTempHome();
    try {
      const logPath = `${tmp.dir}/run.ndjson`;
      const prompt = 'x'.repeat(PROMPT_INLINE_MAX + 1);
      const args = buildArgs({ prompt, model: 'auto', logPath });
      const pointer = args.at(-1);
      expect(pointer).toMatch(/^Read the file at .+ in full and carry out that task\.$/);
      expect(pointer).toContain(`${logPath}.prompt.txt`);
      expect(readFileSync(`${logPath}.prompt.txt`, 'utf8')).toBe(prompt);
    } finally {
      tmp.cleanup();
    }
  });

  it('routes a short prompt with CLI-looking tokens through the sidecar', () => {
    const tmp = makeTempHome();
    try {
      const logPath = `${tmp.dir}/run.ndjson`;
      const prompt = 'compile with -X -ldflags "-s"';
      const args = buildArgs({ prompt, model: 'auto', logPath });
      expect(args.at(-1)).not.toBe(prompt);
      expect(args.at(-1)).toMatch(/^Read the file at /);
      expect(readFileSync(`${logPath}.prompt.txt`, 'utf8')).toBe(prompt);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('childStillRunning / reapChild', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('treats killed=true as still running until exitCode or signalCode is set', () => {
    expect(childStillRunning({ killed: true, exitCode: null, signalCode: null })).toBe(true);
    expect(childStillRunning({ killed: false, exitCode: 0, signalCode: null })).toBe(false);
    expect(childStillRunning({ killed: true, exitCode: null, signalCode: 'SIGTERM' })).toBe(false);
  });

  it('escalates SIGKILL against a stub child whose killed is true but which has not exited', async () => {
    const desc = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) return true;
      return true;
    });
    try {
      const child = { pid: 4242, killed: true, exitCode: null, signalCode: null };
      const outcome = await reapChild(child, { graceMs: 1 });
      const signals = killSpy.mock.calls.map((c) => c[1]);
      expect(signals).toContain('SIGKILL');
      expect(outcome === 'killed' || outcome === 'failed').toBe(true);
    } finally {
      killSpy.mockRestore();
      if (desc) Object.defineProperty(process, 'platform', desc);
    }
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
