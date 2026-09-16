// Integration tests for the model-cache refresh triggers delegate.mjs's
// `main` fires (M3): weekly after a run, before dispatch on a cache miss, and
// after agy rejects a model. `modelCacheStale` and `refreshModelCache` are
// mocked here so each trigger can be checked in isolation without a real
// network call; every other export keeps its real behaviour.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STUB_BIN } from './helpers.mjs';

vi.mock('../scripts/lib/agy.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    modelCacheStale: vi.fn(() => false),
    refreshModelCache: vi.fn(async () => []),
  };
});

const prevHome = process.env.CAD_HOME;
const prevBin = process.env.AGY_BIN;
const prevFixture = process.env.AGY_STUB_FIXTURE;
const prevExit = process.env.AGY_STUB_EXIT;
const prevCwd = process.cwd();

let home;
let repo;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cad-refresh-'));
  repo = mkdtempSync(join(tmpdir(), 'cad-refresh-repo-'));
  process.env.CAD_HOME = home;
  process.env.AGY_BIN = STUB_BIN;
  process.chdir(repo);
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
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
  vi.clearAllMocks();
});

/** A fixture the stub replays: one `result` event, no `init`. */
function writeFixture(dir, name, resultObj) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify({ event: 'result', result: resultObj })}\n`, 'utf8');
  return path;
}

describe('delegate.mjs: weekly refresh trigger', () => {
  it('does not refresh when the cache is not stale', async () => {
    const agy = await import('../scripts/lib/agy.mjs');
    agy.modelCacheStale.mockReturnValue(false);
    const { main } = await import('../scripts/delegate.mjs');
    const fixture = writeFixture(home, 'clean.ndjson', {
      status: 'SUCCESS',
      conversation_id: 'c0ffee00-0000-4000-8000-000000000010',
      response: 'done',
    });
    process.env.AGY_STUB_FIXTURE = fixture;

    const code = await main(['a clean task']);

    expect(code).toBe(0);
    expect(agy.refreshModelCache).not.toHaveBeenCalled();
  });

  it('refreshes once after the run when the cache is a week stale', async () => {
    const agy = await import('../scripts/lib/agy.mjs');
    agy.modelCacheStale.mockReturnValue(true);
    agy.refreshModelCache.mockResolvedValue([]);
    const { main } = await import('../scripts/delegate.mjs');
    const fixture = writeFixture(home, 'stale.ndjson', {
      status: 'SUCCESS',
      conversation_id: 'c0ffee00-0000-4000-8000-000000000011',
      response: 'done',
    });
    process.env.AGY_STUB_FIXTURE = fixture;

    await main(['a task on a stale cache']);

    expect(agy.refreshModelCache).toHaveBeenCalledTimes(1);
  });

  it('a refresh that throws is swallowed and never changes the exit code', async () => {
    const agy = await import('../scripts/lib/agy.mjs');
    agy.modelCacheStale.mockReturnValue(true);
    agy.refreshModelCache.mockRejectedValue(new Error('network down'));
    const { main } = await import('../scripts/delegate.mjs');
    const fixture = writeFixture(home, 'stale-throws.ndjson', {
      status: 'SUCCESS',
      conversation_id: 'c0ffee00-0000-4000-8000-000000000012',
      response: 'done',
    });
    process.env.AGY_STUB_FIXTURE = fixture;

    const code = await main(['a task whose refresh will throw']);

    expect(agy.refreshModelCache).toHaveBeenCalledTimes(1);
    expect(code).toBe(0);
  });
});

describe('delegate.mjs: cache-miss refresh before dispatch', () => {
  it('refreshes once before the run when the requested --model is not cached', async () => {
    const agy = await import('../scripts/lib/agy.mjs');
    agy.modelCacheStale.mockReturnValue(false);
    agy.refreshModelCache.mockResolvedValue([]);
    const { main } = await import('../scripts/delegate.mjs');
    const fixture = writeFixture(home, 'pinned.ndjson', {
      status: 'SUCCESS',
      conversation_id: 'c0ffee00-0000-4000-8000-000000000013',
      response: 'done',
    });
    process.env.AGY_STUB_FIXTURE = fixture;

    await main(['--model', 'some-new-model', 'a task with a fresh model']);

    expect(agy.refreshModelCache).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when the requested --model is already cached', async () => {
    const agy = await import('../scripts/lib/agy.mjs');
    agy.modelCacheStale.mockReturnValue(false);
    agy.writeModelCache([{ id: 'gemini-3.8-flash-high', label: 'a' }], null, null);
    const { main } = await import('../scripts/delegate.mjs');
    const fixture = writeFixture(home, 'pinned2.ndjson', {
      status: 'SUCCESS',
      conversation_id: 'c0ffee00-0000-4000-8000-000000000014',
      response: 'done',
    });
    process.env.AGY_STUB_FIXTURE = fixture;

    await main(['--model', 'gemini-3.8-flash-high', 'a task with a cached model']);

    expect(agy.refreshModelCache).not.toHaveBeenCalled();
  });
});
