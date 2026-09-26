import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORIGINAL_HOME = process.env.CAD_HOME;
let home;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cad-papercuts-'));
  process.env.CAD_HOME = home;
});

afterEach(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.CAD_HOME;
  else process.env.CAD_HOME = ORIGINAL_HOME;
  rmSync(home, { recursive: true, force: true });
});

/** Imported per test so `CAD_HOME` is read fresh. */
async function lib() {
  return import('../scripts/lib/papercuts.mjs');
}

describe('the detected-warning table and the renderer agree', () => {
  it('only files warnings the renderer can actually emit', async () => {
    const { DETECTED_WARNINGS } = await lib();
    const { WARNING_IDS } = await import('../scripts/lib/render.mjs');
    for (const id of Object.keys(DETECTED_WARNINGS)) {
      expect(WARNING_IDS).toContain(id);
    }
  });

  // The subset is the design, not an oversight: agy's own status and the
  // process exit code disagree with reality in both directions and fire on runs
  // that worked, so logging them would bury every real cut. `resume` is an
  // offer, not a problem.
  it('deliberately omits the three warnings that are not friction', async () => {
    const { DETECTED_WARNINGS } = await lib();
    expect(Object.keys(DETECTED_WARNINGS)).not.toContain('agy-status');
    expect(Object.keys(DETECTED_WARNINGS)).not.toContain('exit');
    expect(Object.keys(DETECTED_WARNINGS)).not.toContain('resume');
  });

  it('gives every filed warning a severity', async () => {
    const { DETECTED_WARNINGS } = await lib();
    for (const spec of Object.values(DETECTED_WARNINGS)) {
      expect(['warn', 'info']).toContain(spec.severity);
    }
  });
});

describe('detectedCuts', () => {
  const ctx = {
    toolVersion: '1.1.24',
    pluginVersion: '0.1.0',
    model: 'gemini-3.8-flash',
    repo: 'C:\\repo',
    jobId: 'job-abcd',
    toolCalls: 47,
    agyStatus: 'SUCCESS',
    exitCode: 0,
  };

  it('turns a stderr warning into one cut', async () => {
    const { detectedCuts } = await lib();
    const cuts = detectedCuts(
      [{ id: 'stderr', line: 'agy produced no result. Its stderr:\n  auth required' }],
      ctx,
    );
    expect(cuts).toHaveLength(1);
    expect(cuts[0].source).toBe('detected');
    expect(cuts[0].warningId).toBe('stderr');
    expect(cuts[0].toolCalls).toBe(47);
    // Only the first line: the second is the same fact restated for the reader.
    expect(cuts[0].text).not.toContain('\n');
  });

  it('ignores warnings that are not friction', async () => {
    const { detectedCuts } = await lib();
    const cuts = detectedCuts(
      [
        { id: 'agy-status', line: 'agy status: ERROR (write-up present, 3 files changed)' },
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
    const base = { ts: '2026-09-03T00:00:00Z', source: 'narrated', severity: 'warn', tool: 'agy' };
    const a = appendPapercut({ ...base, text: 'first' });
    const b = appendPapercut({ ...base, ts: '2026-09-03T01:00:00Z', text: 'second' });
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(b).not.toBe(a);

    const raw = readFileSync(join(home, 'papercuts.jsonl'), 'utf8');
    expect(raw.trimEnd().split('\n')).toHaveLength(2);
    expect(readPapercuts().map((c) => c.text)).toEqual(['first', 'second']);
  });

  // Two occurrences of the same problem must stay two rows. Recurrence is the
  // only feedback this loop has — collapsing duplicates would erase the signal
  // that a fix did not work.
  it('gives repeat occurrences distinct ids', async () => {
    const { appendPapercut, readPapercuts } = await lib();
    const cut = { source: 'detected', severity: 'warn', tool: 'agy', text: 'same', warningId: 'stderr' };
    appendPapercut({ ...cut, ts: '2026-09-03T00:00:00Z' });
    appendPapercut({ ...cut, ts: '2026-09-04T00:00:00Z' });
    const ids = readPapercuts().map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('skips a line a crash truncated rather than failing the read', async () => {
    const { appendPapercut, readPapercuts } = await lib();
    appendPapercut({ ts: '2026-09-03T00:00:00Z', source: 'narrated', severity: 'info', tool: 'agy', text: 'good' });
    const { appendFileSync } = await import('node:fs');
    appendFileSync(join(home, 'papercuts.jsonl'), '{"id":"broken","te\n', 'utf8');
    expect(readPapercuts().map((c) => c.text)).toEqual(['good']);
  });

  it('returns an empty list when nothing has been logged yet', async () => {
    const { readPapercuts } = await lib();
    expect(readPapercuts()).toEqual([]);
  });
});

describe('the review /agy:update prints', () => {
  const cut = (ts, warningId = 'stderr') => ({ ts, source: 'detected', severity: 'warn', tool: 'agy', text: `${warningId} at ${ts}`, warningId });

  it('groups open cuts by warning, largest cluster first', async () => {
    const { appendPapercut, formatOpenPapercuts } = await lib();
    appendPapercut(cut('2026-09-01T00:00:00Z', 'timeout'));
    appendPapercut(cut('2026-09-02T00:00:00Z'));
    appendPapercut(cut('2026-09-03T00:00:00Z'));
    const out = formatOpenPapercuts();
    expect(out).toContain('3 open papercuts in 2 clusters');
    expect(out.indexOf('## stderr')).toBeLessThan(out.indexOf('## timeout'));
  });

  it('is empty when nothing is open', async () => {
    const { formatOpenPapercuts } = await lib();
    expect(formatOpenPapercuts()).toBe('');
  });

  it('hides resolved cuts and flags a cluster that came back after its fix', async () => {
    const { main } = await import('../scripts/papercut.mjs');
    const { appendPapercut, formatOpenPapercuts } = await lib();
    const first = appendPapercut(cut('2026-09-01T00:00:00Z'));
    const { vi } = await import('vitest');
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await main(['--resolve', first, '--note', 'fixed the flag']);
    spy.mockRestore();
    expect(code).toBe(0);
    expect(formatOpenPapercuts()).toBe('');

    appendPapercut(cut('2099-01-01T00:00:00Z'));
    const out = formatOpenPapercuts();
    expect(out).toContain('1 open papercut in 1 cluster');
    expect(out).toContain('stderr: 1 new since the');
  });

  it('refuses to resolve an unknown id or one without a note', async () => {
    const { main } = await import('../scripts/papercut.mjs');
    const { appendPapercut } = await lib();
    const id = appendPapercut(cut('2026-09-01T00:00:00Z'));
    const { vi } = await import('vitest');
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await main(['--resolve', 'deadbeef', '--note', 'x'])).toBe(2);
    expect(await main(['--resolve', id])).toBe(2);
    spy.mockRestore();
  });
});
