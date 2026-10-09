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
    for (const id of DETECTED_WARNINGS) {
      expect(WARNING_IDS).toContain(id);
    }
  });

  // The subset is the design, not an oversight: agy's own status and the
  // process exit code disagree with reality in both directions and fire on runs
  // that worked, so logging them would bury every real cut. `resume` is an
  // offer, not a problem.
  it('deliberately omits the three warnings that are not friction', async () => {
    const { DETECTED_WARNINGS } = await lib();
    expect(DETECTED_WARNINGS).not.toContain('agy-status');
    expect(DETECTED_WARNINGS).not.toContain('exit');
    expect(DETECTED_WARNINGS).not.toContain('resume');
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

  it('turns a stderr warning into one cut whose text is the first stderr line', async () => {
    const { detectedCuts } = await lib();
    const cuts = detectedCuts(
      [{ id: 'stderr', line: 'agy wrote to stderr:', detail: ['auth required', 'retry later'] }],
      { ...ctx, stderrTail: ['auth required', 'retry later'] },
    );
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({ source: 'detected', key: 'stderr', text: 'auth required', toolCalls: 47 });
    expect(cuts[0].evidence).toEqual({ agyStatus: 'SUCCESS', exitCode: 0, more: ['retry later'] });
  });

  // Keyed by tool, so a failure in one tool never counts against a fix to another.
  it('writes one cut per failing tool, keyed by the tool', async () => {
    const { detectedCuts } = await lib();
    const toolErrors = [
      { tool: 'view_file', message: 'file not found: a.ts' },
      { tool: 'view_file', message: 'file not found: a.ts' },
      { tool: 'view_file', message: 'file not found: b.ts\nstack' },
      { tool: 'rg', message: 'unknown tool: "rg"' },
    ];
    const cuts = detectedCuts([{ id: 'tool-errors', line: '3 tool calls failed during the run — reported, not judged:' }], {
      ...ctx,
      toolErrors,
    });
    expect(cuts.map((c) => [c.key, c.text, c.count])).toEqual([
      ['tool-errors:view_file', 'file not found: a.ts', 3],
      ['tool-errors:rg', 'unknown tool: "rg"', 1],
    ]);
    expect(cuts[0].evidence.more).toEqual(['file not found: b.ts stack']);
    expect(cuts[1].evidence.more).toBeUndefined();
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
    const base = { ts: '2026-09-03T00:00:00Z', source: 'narrated', key: 'narrated' };
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
    const cut = { source: 'detected', key: 'stderr', text: 'same' };
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

describe('the review /agy:update prints', () => {
  const cut = (ts, key = 'stderr', text = `${key} at ${ts}`) => ({ ts, source: 'detected', key, text });
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
    appendPapercut(cut('2026-09-01T00:00:00Z', 'timeout'));
    appendPapercut(cut('2026-09-02T00:00:00Z'));
    appendPapercut(cut('2026-09-03T00:00:00Z'));
    const out = formatOpenPapercuts();
    expect(out).toContain('3 open papercuts in 2 clusters');
    expect(out.indexOf('## stderr')).toBeLessThan(out.indexOf('## timeout'));
  });

  it('prints each distinct message once, with how often it occurred', async () => {
    const { appendPapercut, formatOpenPapercuts } = await lib();
    appendPapercut(cut('2026-09-01T00:00:00Z', 'tool-errors:rg', 'unknown tool: "rg"'));
    appendPapercut(cut('2026-09-02T00:00:00Z', 'tool-errors:rg', 'unknown tool: "rg"'));
    const out = formatOpenPapercuts();
    expect(out).toContain('## tool-errors:rg — 2×, 2026-09-01 to 2026-09-02');
    expect(out.match(/unknown tool/g)).toHaveLength(1);
  });

  it('is empty when nothing is open', async () => {
    const { formatOpenPapercuts } = await lib();
    expect(formatOpenPapercuts()).toBe('');
  });

  it('drops agy\'s permission wrapper from messages and sorts versions', async () => {
    const { appendPapercut, formatOpenPapercuts } = await lib();
    const wrapped = (path) =>
      'declaring permissions: cortex tool view_file: convert tool call for permissions: model output error: ' +
      `invalid tool call error (invalid_args) failed to read file: open ${path}: not found`;
    appendPapercut({ ...cut('2026-09-01T00:00:00Z', 'tool-errors:view_file', wrapped('a.ts')), toolVersion: '1.2.11' });
    appendPapercut({ ...cut('2026-09-02T00:00:00Z', 'tool-errors:view_file', wrapped('b.ts')), toolVersion: '1.2.2' });
    const out = formatOpenPapercuts();
    expect(out).toContain('agy 1.2.2 1.2.11');
    expect(out).toContain('2026-09-01  failed to read file: open a.ts: not found');
    expect(out).not.toContain('declaring permissions');
  });

  it('closes a whole key, and flags that key when it comes back', async () => {
    const { main } = await import('../scripts/papercut.mjs');
    const { appendPapercut, formatOpenPapercuts } = await lib();
    appendPapercut(cut('2026-09-01T00:00:00Z'));
    appendPapercut(cut('2026-09-02T00:00:00Z'));
    appendPapercut(cut('2026-09-02T00:00:00Z', 'tool-errors:rg'));
    expect(await quiet(() => main(['--resolve', 'stderr', '--note', 'fixed the flag']))).toBe(0);
    expect(formatOpenPapercuts()).toContain('1 open papercut in 1 cluster');

    appendPapercut(cut('2099-01-01T00:00:00Z'));
    const out = formatOpenPapercuts();
    expect(out).toContain('stderr: 1 new since the');
    expect(out).toContain('(fixed the flag)');
    expect(out).not.toContain('tool-errors:rg: ');
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
});
