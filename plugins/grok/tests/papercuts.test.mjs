import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORIGINAL_HOME = process.env.CGD_HOME;
let home;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cgd-papercuts-'));
  process.env.CGD_HOME = home;
});

afterEach(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.CGD_HOME;
  else process.env.CGD_HOME = ORIGINAL_HOME;
  rmSync(home, { recursive: true, force: true });
});

/** Imported per test so `CGD_HOME` is read fresh. */
async function lib() {
  return import('../scripts/lib/papercuts.mjs');
}

describe('the detected-warning table and the renderer agree', () => {
  it('only files warnings the renderer can actually emit', async () => {
    const { DETECTED_WARNINGS } = await lib();
    const { WARNING_IDS } = await import('../scripts/lib/render.mjs');
    for (const id of DETECTED_WARNINGS) {
      expect(WARNING_IDS).toContain(id);
    }
  });

  // `stop-reason` and `exit` restate what `error-detail` and `killed` explain,
  // and `resume` is an offer rather than a problem.
  it('omits the three warnings that are not friction', async () => {
    const { DETECTED_WARNINGS } = await lib();
    expect(DETECTED_WARNINGS).not.toContain('stop-reason');
    expect(DETECTED_WARNINGS).not.toContain('exit');
    expect(DETECTED_WARNINGS).not.toContain('resume');
  });
});

describe('detectedCuts', () => {
  const ctx = {
    toolVersion: '1.0.52',
    pluginVersion: '0.5.0',
    model: 'grok-4.7',
    repo: 'C:/repo',
    jobId: 'job-abcd',
    sessionId: '0b9e7c1e-3c55-4a51-9c2e-2f4c8e0f6a11',
    toolCalls: 47,
    stopReason: 'end_turn',
    exitCode: 0,
  };

  it('turns a wander into one cut keyed by the warning, first line only', async () => {
    const { detectedCuts } = await lib();
    const cuts = detectedCuts(
      [{ id: 'wander', line: 'grok reported file changes but the working tree is unchanged — x\n  y' }],
      ctx,
    );
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({ source: 'detected', key: 'wander', toolCalls: 47, sessionId: ctx.sessionId });
    expect(cuts[0].text).not.toContain('\n');
  });

  it('files grok’s error under error-detail, without the label', async () => {
    const { detectedCuts } = await lib();
    const cuts = detectedCuts(
      [{ id: 'error-detail', line: 'error: not signed in', detail: ['run `grok login`'] }],
      ctx,
    );
    expect(cuts[0]).toMatchObject({ key: 'error-detail', text: 'not signed in' });
    expect(cuts[0].evidence).toEqual({ stopReason: 'end_turn', exitCode: 0, more: ['run `grok login`'] });
  });

  it('writes one cut for all failed commands, counting them', async () => {
    const { detectedCuts } = await lib();
    const failedCommands = [
      { command: 'pnpm test', exitCode: 1 },
      { command: 'pnpm test', exitCode: 1 },
      { command: 'rg nothing', exitCode: 1 },
    ];
    const cuts = detectedCuts([{ id: 'failed-commands', line: '3 commands exited non-zero' }], {
      ...ctx,
      failedCommands,
    });
    expect(cuts.map((c) => [c.key, c.text, c.count])).toEqual([
      ['failed-commands', 'pnpm test → exit 1', 3],
    ]);
    expect(cuts[0].evidence.more).toEqual(['rg nothing → exit 1']);
  });

  it('ignores warnings that are not friction', async () => {
    const { detectedCuts } = await lib();
    const cuts = detectedCuts(
      [
        { id: 'stop-reason', line: 'stop reason: max_tokens' },
        { id: 'exit', line: 'exit 1' },
        { id: 'resume', line: 'this run can be resumed' },
      ],
      ctx,
    );
    expect(cuts).toEqual([]);
  });

  it('writes nothing for a clean run', async () => {
    const { detectedCuts } = await lib();
    expect(detectedCuts([], ctx)).toEqual([]);
  });
});

describe('the log itself', () => {
  it('appends one JSON object per line and reads them back', async () => {
    const { appendPapercut, readPapercuts } = await lib();
    const base = { ts: '2026-09-03T00:00:00Z', source: 'narrated', key: 'narrated' };
    const a = appendPapercut({ ...base, text: 'first' });
    const b = appendPapercut({ ...base, ts: '2026-09-03T01:00:00Z', text: 'second' });
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(b).not.toBe(a);

    const raw = readFileSync(join(home, 'papercuts.jsonl'), 'utf8');
    expect(raw.trimEnd().split('\n')).toHaveLength(2);
    expect(readPapercuts().map((c) => c.text)).toEqual(['first', 'second']);
  });

  // Two occurrences of the same problem stay two rows: recurrence is how a
  // fix that did not hold shows up.
  it('gives repeat occurrences distinct ids', async () => {
    const { appendPapercut, readPapercuts } = await lib();
    const cut = { source: 'detected', key: 'wander', text: 'same' };
    appendPapercut({ ...cut, ts: '2026-09-03T00:00:00Z' });
    appendPapercut({ ...cut, ts: '2026-09-04T00:00:00Z' });
    const ids = readPapercuts().map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('skips a line a crash truncated rather than failing the read', async () => {
    const { appendPapercut, readPapercuts } = await lib();
    appendPapercut({ ts: '2026-09-03T00:00:00Z', source: 'narrated', key: 'narrated', text: 'good' });
    const { appendFileSync } = await import('node:fs');
    appendFileSync(join(home, 'papercuts.jsonl'), '{"id":"broken","te\n', 'utf8');
    expect(readPapercuts().map((c) => c.text)).toEqual(['good']);
  });

  it('returns an empty list when nothing has been logged yet', async () => {
    const { readPapercuts } = await lib();
    expect(readPapercuts()).toEqual([]);
  });
});

describe('the review /grok:update prints', () => {
  const cut = (ts, key = 'wander', text = `${key} at ${ts}`) => ({ ts, source: 'detected', key, text });
  const quiet = async (fn) => {
    const { vi } = await import('vitest');
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      return await fn();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  };

  it('groups open cuts by key, largest cluster first', async () => {
    const { appendPapercut, formatOpenPapercuts } = await lib();
    appendPapercut(cut('2026-09-01T00:00:00Z', 'killed'));
    appendPapercut(cut('2026-09-02T00:00:00Z'));
    appendPapercut(cut('2026-09-03T00:00:00Z'));
    const out = formatOpenPapercuts();
    expect(out).toContain('3 open papercuts in 2 clusters');
    expect(out.indexOf('## wander')).toBeLessThan(out.indexOf('## killed'));
  });

  it('prints each distinct message once, with how often it occurred', async () => {
    const { appendPapercut, formatOpenPapercuts } = await lib();
    appendPapercut(cut('2026-09-01T00:00:00Z', 'error-detail', 'not signed in'));
    appendPapercut(cut('2026-09-02T00:00:00Z', 'error-detail', 'not signed in'));
    const out = formatOpenPapercuts();
    expect(out).toContain('## error-detail — 2×, 2026-09-01 to 2026-09-02');
    expect(out.match(/not signed in/g)).toHaveLength(1);
  });

  it('sorts grok versions numerically', async () => {
    const { appendPapercut, formatOpenPapercuts } = await lib();
    appendPapercut({ ...cut('2026-09-01T00:00:00Z'), toolVersion: '1.0.52' });
    appendPapercut({ ...cut('2026-09-02T00:00:00Z'), toolVersion: '1.0.6' });
    expect(formatOpenPapercuts()).toContain('grok 1.0.6 1.0.52');
  });

  it('is empty when nothing is open', async () => {
    const { formatOpenPapercuts } = await lib();
    expect(formatOpenPapercuts()).toBe('');
  });

  it('closes a whole key, and flags that key when it comes back', async () => {
    const { main } = await import('../scripts/papercut.mjs');
    const { appendPapercut, formatOpenPapercuts } = await lib();
    appendPapercut(cut('2026-09-01T00:00:00Z'));
    appendPapercut(cut('2026-09-02T00:00:00Z'));
    appendPapercut(cut('2026-09-02T00:00:00Z', 'killed'));
    expect(await quiet(() => main(['--resolve', 'wander', '--note', 'fixed the cwd']))).toBe(0);
    expect(formatOpenPapercuts()).toContain('1 open papercut in 1 cluster');

    appendPapercut(cut('2099-01-01T00:00:00Z'));
    const out = formatOpenPapercuts();
    expect(out).toContain('wander: 1 new since the');
    expect(out).toContain('(fixed the cwd)');
    expect(out).not.toContain('killed: ');
  });

  it('closes a single cut by id', async () => {
    const { main } = await import('../scripts/papercut.mjs');
    const { appendPapercut, formatOpenPapercuts } = await lib();
    const first = appendPapercut(cut('2026-09-01T00:00:00Z'));
    appendPapercut(cut('2026-09-02T00:00:00Z'));
    expect(await quiet(() => main(['--resolve', first, '--note', 'one-off']))).toBe(0);
    const out = formatOpenPapercuts();
    expect(out).toContain('1 open papercut in 1 cluster');
    // An id closure says nothing about the key, so the later cut is not a recurrence.
    expect(out).not.toContain('Recurred');
  });

  it('refuses to resolve an unknown key or id, or one without a note', async () => {
    const { main } = await import('../scripts/papercut.mjs');
    const { appendPapercut } = await lib();
    const id = appendPapercut(cut('2026-09-01T00:00:00Z'));
    expect(await quiet(() => main(['--resolve', 'deadbeef', '--note', 'x']))).toBe(2);
    expect(await quiet(() => main(['--resolve', id]))).toBe(2);
  });

  it('records a cut from --text alone as narrated', async () => {
    const { STUB_BIN } = await import('./helpers.mjs');
    const prevBin = process.env.GROK_BIN;
    process.env.GROK_BIN = STUB_BIN;
    try {
      const { main } = await import('../scripts/papercut.mjs');
      const { readPapercuts } = await lib();
      expect(await quiet(() => main(['--text', 'shell tool refused']))).toBe(0);
      const [cutRow] = readPapercuts();
      expect(cutRow.source).toBe('narrated');
      expect(cutRow.key).toBe('narrated');
      expect(cutRow.text).toBe('shell tool refused');
    } finally {
      if (prevBin === undefined) delete process.env.GROK_BIN;
      else process.env.GROK_BIN = prevBin;
    }
  });
});
