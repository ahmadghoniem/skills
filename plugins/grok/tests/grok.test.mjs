import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HAPPY_FIXTURE, STUB_BIN, makeTempHome } from './helpers.mjs';

// Captured verbatim from `grok models` on 1.0.5, exit 0, authenticated.
// The previous version of this fixture opened with "You are not authenticated."
// on the belief that grok printed that even on a working install. It does not —
// that claim is disproved and the code comments asserting it are gone.
const REAL_MODELS_STDOUT = [
  'You are logged in with grok.com.',
  '',
  'Default model: grok-4.6',
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

});

describe('parseVersion', () => {
  it('reads the version out of `grok --version`', async () => {
    const { parseVersion } = await import('../scripts/lib/grok.mjs');
    expect(parseVersion('grok 1.0.52 (0920c8169e27) [stable]')).toBe('1.0.52');
    expect(parseVersion('1.0.5\n')).toBe('1.0.5');
    expect(parseVersion('no version here')).toBeNull();
  });
});

describe('efforts', () => {
  // The xAI plan this was built on allows only low and medium.
  it('accepts low and medium, defaulting to medium', async () => {
    const { DEFAULT_EFFORT, EFFORTS } = await import('../scripts/lib/grok.mjs');
    expect(EFFORTS).toEqual(['low', 'medium']);
    expect(DEFAULT_EFFORT).toBe('medium');
  });
});

describe('COMPAT_OFF_ENV', () => {
  it('switches off every Claude and Cursor compat source', async () => {
    const { COMPAT_OFF_ENV } = await import('../scripts/lib/grok.mjs');
    expect(Object.keys(COMPAT_OFF_ENV)).toHaveLength(10);
    expect(COMPAT_OFF_ENV.GROK_CLAUDE_SKILLS_ENABLED).toBe('false');
    expect(COMPAT_OFF_ENV.GROK_CURSOR_MCPS_ENABLED).toBe('false');
    expect(new Set(Object.values(COMPAT_OFF_ENV))).toEqual(new Set(['false']));
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

  // The account default (grok-4.7 today) applies when no model is named.
  it('passes no -m when no model was given', async () => {
    const { buildArgs } = await import('../scripts/lib/grok.mjs');
    expect(buildArgs({ promptFile: '/tmp/brief.md' })).not.toContain('-m');
  });

  it('does not trust the repo, so grok sees only the brief', async () => {
    const { buildArgs } = await import('../scripts/lib/grok.mjs');
    expect(buildArgs({ promptFile: '/tmp/brief.md' })).not.toContain('--trust');
  });

  it('turns plan mode off and removes the tools a delegated run has no use for', async () => {
    const { buildArgs, DISALLOWED_TOOLS } = await import('../scripts/lib/grok.mjs');
    const args = buildArgs({ promptFile: '/tmp/brief.md' });
    expect(args).toContain('--no-plan');
    const i = args.indexOf('--disallowed-tools');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe(DISALLOWED_TOOLS.join(','));
    for (const kept of ['read_file', 'write_file', 'edit_file', 'run_terminal_command']) {
      expect(DISALLOWED_TOOLS).not.toContain(kept);
    }
  });

  it('adds --reasoning-effort only when an effort was given', async () => {
    const { buildArgs } = await import('../scripts/lib/grok.mjs');
    const withEffort = buildArgs({
      promptFile: '/tmp/brief.md',
      model: 'grok-4.6',
      effort: 'low',
    });
    expect(withEffort).toContain('--reasoning-effort');
    expect(withEffort).toContain('low');
    const without = buildArgs({ promptFile: '/tmp/brief.md', model: 'grok-4.6' });
    expect(without).not.toContain('--reasoning-effort');
  });

  // `--continue` means "newest session in this directory", which grok resolves
  // without regard to who dispatched — so a second Claude session in the same
  // repo could be attached to silently. There is no longer any input that
  // produces it: a resume always names its session.
  it('names the session on a resume and never emits --continue', async () => {
    const { buildArgs } = await import('../scripts/lib/grok.mjs');
    const resume = buildArgs({
      promptFile: '/tmp/brief.md',
      model: 'grok-4.6',
      resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    expect(resume).toContain('--resume');
    expect(resume).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(resume).not.toContain('--continue');

    const bare = buildArgs({ promptFile: '/tmp/brief.md', model: 'grok-4.6' });
    expect(bare).not.toContain('--continue');
    expect(bare).not.toContain('--resume');
  });
});


describe('escalateSigkill', () => {
  it('fires SIGKILL against a stub child whose killed is true but which has not exited', async () => {
    const { escalateSigkill } = await import('../scripts/lib/grok.mjs');
    const child = {
      killed: true,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
    };
    escalateSigkill(child);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('does not SIGKILL a child that has already exited', async () => {
    const { escalateSigkill } = await import('../scripts/lib/grok.mjs');
    const child = {
      killed: true,
      exitCode: 1,
      signalCode: null,
      kill: vi.fn(),
    };
    escalateSigkill(child);
    expect(child.kill).not.toHaveBeenCalled();
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

  it('reports the grok child pid via onSpawn as soon as it spawns', async () => {
    const { runHeadless } = await import('../scripts/lib/grok.mjs');
    const onSpawn = vi.fn();
    const result = await runHeadless({
      prompt: 'hi',
      model: 'grok-4.6',
      logPath: `${tmp.dir}/spawn.ndjson`,
      timeoutSec: 10,
      onSpawn,
    });
    expect(result.exitCode).toBe(0);
    expect(onSpawn).toHaveBeenCalledTimes(1);
    expect(onSpawn.mock.calls[0][0]).toEqual(expect.any(Number));
    expect(onSpawn.mock.calls[0][0]).toBeGreaterThan(0);
  });
});

describe('buildArgs session pre-assignment', () => {
  const base = {
    promptFile: 'C:/tmp/brief.md',
    model: 'grok-4.6',
  };

  it('names a fresh session with -s so a killed run stays resumable', async () => {
    const { buildArgs } = await import('../scripts/lib/grok.mjs');
    const args = buildArgs({ ...base, sessionId: '11111111-2222-3333-4444-555555555555' });
    expect(args).toContain('-s');
    expect(args[args.indexOf('-s') + 1]).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('never passes -s on a resume — it declares a NEW conversation', async () => {
    const { buildArgs } = await import('../scripts/lib/grok.mjs');
    const byId = buildArgs({
      ...base,
      sessionId: '11111111-2222-3333-4444-555555555555',
      resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    expect(byId).not.toContain('-s');
    expect(byId).toContain('--resume');

  });

  it('omits -s entirely when no session id was assigned', async () => {
    const { buildArgs } = await import('../scripts/lib/grok.mjs');
    expect(buildArgs(base)).not.toContain('-s');
  });
});
