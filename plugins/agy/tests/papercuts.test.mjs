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
    filesChanged: 0,
    agyStatus: 'SUCCESS',
    exitCode: 0,
    writeTargets: ['src/a.mjs'],
    scratchPaths: ['~/.gemini/antigravity-cli/scratch/a.mjs'],
  };

  it('turns a wander into one cut carrying the scratch paths', async () => {
    const { detectedCuts } = await lib();
    const cuts = detectedCuts(
      [{ id: 'wander', line: 'agy reported file changes but the working tree is unchanged — x\n  y' }],
      ctx,
    );
    expect(cuts).toHaveLength(1);
    expect(cuts[0].source).toBe('detected');
    expect(cuts[0].warningId).toBe('wander');
    expect(cuts[0].toolCalls).toBe(47);
    expect(cuts[0].filesChanged).toBe(0);
    expect(cuts[0].evidence.scratchPaths).toEqual(ctx.scratchPaths);
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
    const cut = { source: 'detected', severity: 'warn', tool: 'agy', text: 'same', warningId: 'wander' };
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
