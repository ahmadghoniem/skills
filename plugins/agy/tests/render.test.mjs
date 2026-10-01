import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeModelCache } from '../scripts/lib/agy.mjs';
import { anomalies, isUnfinished, renderResult } from '../scripts/lib/render.mjs';

describe('renderResult', () => {
  const base = {
    id: 'add-retry-to-fetchuser-a7f3',
    agyStatus: 'SUCCESS',
    exitCode: 0,
    durationSeconds: 102,
    conversationId: 'b8b3e36f-3fb0-4d55-a0ee-8a839b4b0fe4',
    summary: 'Added retry to fetchUser and a covering test.\n',
  };

  it('a clean run is agy\u2019s report and nothing else', () => {
    expect(renderResult(base)).toBe('Added retry to fetchUser and a covering test.\n');
  });

  it('prints no status table, no duration, no conversation id, no file list', () => {
    const out = renderResult(base);
    expect(out).not.toMatch(/status/i);
    expect(out).not.toContain('exit');
    expect(out).not.toContain('1m 42s');
    expect(out).not.toContain('b8b3e36f-3fb0-4d55-a0ee-8a839b4b0fe4');
    expect(out).not.toContain('src/api/user.ts');
  });

  it('never renders usage, tokens, or a cost line', () => {
    const out = renderResult({ ...base, usage: { input_tokens: 1, output_tokens: 2 } });
    expect(out).not.toMatch(/input_tokens/);
    expect(out).not.toMatch(/cost/i);
    expect(out).not.toMatch(/token/i);
  });

  it('raises a non-SUCCESS agy status', () => {
    const out = renderResult({ ...base, agyStatus: 'ERROR' });
    expect(out).toContain('\u26a0 agy status: ERROR');
  });

  it('raises a non-zero exit independently of agy status', () => {
    const out = renderResult({ ...base, agyStatus: 'SUCCESS', exitCode: 1 });
    expect(out).toContain('\u26a0 exit 1');
    expect(out).not.toContain('agy status');
  });

  it('does not collapse status and exit code — both can fire at once', () => {
    const out = renderResult({ ...base, agyStatus: 'ERROR', exitCode: 2 });
    expect(out).toContain('\u26a0 agy status: ERROR');
    expect(out).toContain('\u26a0 exit 2');
  });

  it('reports ERROR with exit 0, which agy does emit on a run that worked', () => {
    const out = renderResult({ ...base, agyStatus: 'ERROR', exitCode: 0 });
    expect(out).toContain('\u26a0 agy status: ERROR');
    expect(out).not.toContain('exit');
    expect(out).toContain('Added retry to fetchUser');
  });

  it('keeps a multi-line error verbatim and untruncated', () => {
    const out = renderResult({
      ...base,
      agyStatus: 'ERROR',
      exitCode: 1,
      error:
        'permission check failed for command "echo SHELLOK": user denied permission to run command:\necho SHELLOK',
      summary: '',
    });
    expect(out).toContain(
      '⚠ permission check failed for command "echo SHELLOK": user denied permission to run command:',
    );
    expect(out).toContain('echo SHELLOK');
  });

  it('reports a watchdog kill', () => {
    const out = renderResult({ ...base, killed: true });
    expect(out).toContain('\u26a0 watchdog killed the run');
  });

  it('reports agy’s own print timeout, with its Go duration token verbatim', () => {
    const out = renderResult({ ...base, timedOut: true, timedOutAfter: '1h0m0s' });
    expect(out).toContain(
      '⚠ agy hit its print timeout after 1h0m0s; the output is partial',
    );
  });

  it('offers a resume on a killed run that captured a conversation id', () => {
    const killed = renderResult({ ...base, killed: true });
    expect(killed).toContain(
      '\u26a0 this run can be resumed where it stopped: /agy:resume add-retry-to-fetchuser-a7f3',
    );

    // No id captured means the line would point at nothing.
    expect(renderResult({ ...base, killed: true, conversationId: undefined })).not.toContain(
      '/agy:resume',
    );
  });

  it('offers a resume on every ending that can be resumed, not only a watchdog kill', () => {
    // agy's own timeout stops the run before the watchdog almost ever gets
    // the chance, and a dropped connection or quota error both end with agy
    // status ERROR. All three still have a conversation worth continuing.
    expect(renderResult({ ...base, timedOut: true, timedOutAfter: '15s' })).toContain(
      '/agy:resume',
    );
    expect(renderResult({ ...base, agyStatus: 'ERROR', exitCode: 0 })).toContain('/agy:resume');
    expect(renderResult({ ...base, agyStatus: 'ERROR', exitCode: 1 })).toContain('/agy:resume');
  });

  it('does not offer resume for a never-started run: no conversation id', () => {
    expect(
      renderResult({
        id: 'x-8888',
        status: 'failed',
        agyStatus: 'ERROR',
        exitCode: 1,
        summary: '',
        conversationId: undefined,
      }),
    ).not.toContain('/agy:resume');
  });

  it('says so when agy returned nothing at all', () => {
    expect(renderResult({ ...base, summary: '' })).toBe('(agy returned no report)\n');
  });
});

describe('isUnfinished', () => {
  it('is true for each plugin status that means the run did not complete', () => {
    expect(isUnfinished({ id: 'x', status: 'failed' })).toBe(true);
    expect(isUnfinished({ id: 'x', status: 'cancelled' })).toBe(true);
    expect(isUnfinished({ id: 'x', status: 'orphaned' })).toBe(true);
  });

  it('is true when the watchdog killed the run or agy hit its own timeout', () => {
    expect(isUnfinished({ id: 'x', status: 'done', killed: true })).toBe(true);
    expect(isUnfinished({ id: 'x', status: 'done', timedOut: true })).toBe(true);
  });

  it('is true when agy itself reports status ERROR, even with plugin status done', () => {
    expect(isUnfinished({ id: 'x', status: 'done', agyStatus: 'ERROR' })).toBe(true);
  });

  it('is false for a done run with a clean agy status', () => {
    expect(isUnfinished({ id: 'x', status: 'done', agyStatus: 'SUCCESS' })).toBe(false);
    expect(isUnfinished({ id: 'x', status: 'done', agyStatus: null })).toBe(false);
  });
});

describe('anomalies', () => {
  it('is empty for a clean run', () => {
    expect(
      anomalies({
        id: 'x',
        agyStatus: 'SUCCESS',
        exitCode: 0,
        summary: 'done',
      }),
    ).toEqual([]);
  });

  it('treats a missing status as unremarkable rather than a failure', () => {
    expect(anomalies({ id: 'x', agyStatus: null, exitCode: 0 })).toEqual([]);
  });
});

describe('tool failures during a run', () => {
  const base = {
    id: 'x-1111',
    agyStatus: 'SUCCESS',
    exitCode: 0,
    summary: 'Fixed the failing test.\n',
  };

  it('surfaces a failed tool even when agy reported SUCCESS', () => {
    // The case the whole feature exists for: the verification step failed and
    // agy narrated success anyway. Without this line the caller has no basis to
    // decide whether the write-up can be trusted without redoing the work.
    const out = renderResult({
      ...base,
      toolErrors: [{ tool: 'run_command', message: 'npm test exited 1' }],
    });
    expect(out).toContain('Fixed the failing test.');
    expect(out).toContain('⚠ 1 tool call failed');
    expect(out).toContain('run_command: npm test exited 1');
  });

  it('never flips the verdict — it reports, it does not judge', () => {
    const out = renderResult({
      ...base,
      toolErrors: [{ tool: 'run_command', message: 'grep found nothing' }],
    });
    // A non-zero tool is routinely intentional. The status line must stay absent
    // on a SUCCESS run; only the factual failure line is added.
    expect(out).not.toMatch(/agy status/);
    expect(out).not.toContain('exit ');
  });

  it('dedupes a retried tool and caps the list', () => {
    const repeated = Array.from({ length: 4 }, () => ({
      tool: 'run_command',
      message: 'flaky',
    }));
    expect(renderResult({ ...base, toolErrors: repeated })).toContain('1 tool call failed');

    const many = Array.from({ length: 6 }, (_, i) => ({ tool: `t${i}`, message: `m${i}` }));
    const out = renderResult({ ...base, toolErrors: many });
    expect(out).toContain('6 tool calls failed');
    expect(out).toContain('… and 3 more');
    expect(out).not.toContain('t5: m5');
  });

  it('keeps only the first line of a multi-line tool error', () => {
    const out = renderResult({
      ...base,
      toolErrors: [{ tool: 'run_command', message: 'permission check failed\necho SHELLOK' }],
    });
    expect(out).toContain('run_command: permission check failed');
    expect(out).not.toContain('echo SHELLOK');
  });

  it('adds nothing when no tool failed', () => {
    expect(anomalies({ ...base, toolErrors: [] })).toEqual([]);
    expect(anomalies(base)).toEqual([]);
  });
});

describe('stderr when agy produced no result', () => {
  it('prints the stderr tail when there is no write-up and no status', () => {
    // Unauthenticated / unknown --model / rejected flag all land here: agy exits
    // non-zero with no `result` event, so the only explanation is on stderr.
    const out = renderResult({
      id: 'x-2222',
      exitCode: 1,
      summary: '',
      agyStatus: null,
      stderrTail: ['authentication required', 'run `agy login`'],
    });
    expect(out).toContain('⚠ exit 1');
    expect(out).toContain('agy wrote to stderr:');
    expect(out).toContain('  authentication required');
    expect(out).toContain('  run `agy login`');
  });

  it('shows the stderr tail even on a run that also produced a write-up', () => {
    // 1.2.2 moved its own timeout notice and network errors onto stderr for
    // runs that do return a status and a report. Hiding stderr whenever a
    // write-up exists would hide exactly those lines.
    const out = renderResult({
      id: 'x-3333',
      agyStatus: 'SUCCESS',
      exitCode: 0,
      summary: 'Done.\n',
      stderrTail: ['warning: something chatty'],
    });
    expect(out).toContain('Done.');
    expect(out).toContain('⚠ agy wrote to stderr:');
    expect(out).toContain('  warning: something chatty');
  });

  it('names the spawn failure instead of a bare exit 127', () => {
    const out = renderResult({
      id: 'x-5555',
      exitCode: 127,
      summary: '',
      agyStatus: null,
      stderrTail: ['spawn failed: ENOENT'],
    });
    expect(out).toContain('spawn failed: ENOENT');
  });
});

describe('long agy errors', () => {
  it('truncates the tail and says how much was dropped', () => {
    // An unknown --model appends the whole model catalogue: sixteen lines of
    // menu behind one line of fact. The fact is the first line.
    const error = ['model nope is not recognized', 'Available models:']
      .concat(Array.from({ length: 14 }, (_, i) => `  Model ${i}`))
      .join('\n');
    const out = renderResult({ id: 'x-6666', agyStatus: 'ERROR', exitCode: 1, summary: '', error });
    expect(out).toContain('⚠ model nope is not recognized');
    expect(out).toContain('  Available models:');
    expect(out).toMatch(/… \d+ more lines \(full text in the job log\)/);
    expect(out).not.toContain('Model 13');
  });

  it('leaves a short error intact', () => {
    const out = renderResult({
      id: 'x-7777',
      agyStatus: 'ERROR',
      exitCode: 1,
      summary: '',
      error: 'one line only',
    });
    // status, exit code and error stay three separate facts — never collapsed.
    // The status line carries its measured context; that is disambiguation, not
    // a fourth fact folded into the first three.
    expect(out).toBe(
      '⚠ agy status: ERROR (no write-up)\n⚠ exit 1\n⚠ one line only\n',
    );
  });
});

describe('invalid model selection', () => {
  const prevHome = process.env.CAD_HOME;
  /** @type {string[]} */
  const dirs = [];

  function freshHome() {
    const dir = mkdtempSync(join(tmpdir(), 'cad-render-'));
    dirs.push(dir);
    process.env.CAD_HOME = dir;
    return dir;
  }

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CAD_HOME;
    else process.env.CAD_HOME = prevHome;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('replaces the detail with the cached ids instead of agy’s display labels', () => {
    freshHome();
    writeModelCache(
      [
        { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
        { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
      ],
      null,
      null,
    );
    const out = renderResult({
      id: 'x-9999',
      agyStatus: 'ERROR',
      exitCode: 1,
      summary: '',
      error:
        'invalid model selection (--model "not-a-model" --effort ""): model not recognized',
    });
    expect(out).toContain('⚠ invalid model selection');
    expect(out).toContain('  Valid ids:');
    expect(out).toContain('    gemini-3.8-flash-high');
    expect(out).toContain('    claude-opus-4-6-thinking');
    // Not agy's own display labels — those cannot be passed back to --model.
    expect(out).not.toContain('(High)');
  });

  it('is case-insensitive and matches anywhere in the error text', () => {
    freshHome();
    writeModelCache([{ id: 'gemini-3.8-flash-high', label: 'a' }], null, null);
    const out = renderResult({
      id: 'x-8888',
      agyStatus: 'ERROR',
      exitCode: 1,
      summary: '',
      error: 'Invalid Model Selection: nope is Not Recognized',
    });
    expect(out).toContain('  Valid ids:');
    expect(out).toContain('    gemini-3.8-flash-high');
  });

  it('keeps agy’s own text for an --effort mismatch, which already names the levels', () => {
    freshHome();
    writeModelCache([{ id: 'gemini-3.1-pro-high', label: 'a' }], null, null);
    const out = renderResult({
      id: 'x-6666',
      agyStatus: 'ERROR',
      exitCode: 1,
      summary: '',
      error:
        'invalid model selection (--model "gemini-3.1-pro" --effort "medium"): gemini-3.1-pro has no "medium" effort (available: low, high)',
    });
    expect(out).toContain('(available: low, high)');
    expect(out).not.toContain('Valid ids:');
  });

  it('falls back to an empty list when there is no cache, rather than throwing', () => {
    freshHome();
    const out = renderResult({
      id: 'x-7777',
      agyStatus: 'ERROR',
      exitCode: 1,
      summary: '',
      error: 'invalid model selection: nope not recognized',
    });
    expect(out).toContain('  Valid ids:');
  });
});

describe('agy API errors', () => {
  it('offers resume on exit 3, the code agy uses when a turn ends on an API error', () => {
    const out = renderResult({
      id: 'x-5555',
      agyStatus: 'SUCCESS',
      exitCode: 3,
      conversationId: 'c1',
      summary: 'partial report',
      stderrTail: ['AGY_ERROR: {"short_error":"UNAVAILABLE"}'],
    });
    expect(out).toContain('⚠ exit 3');
    expect(out).toContain('AGY_ERROR: {"short_error":"UNAVAILABLE"}');
    expect(out).toContain('⚠ this run can be resumed where it stopped: /agy:resume x-5555');
  });
});

describe('compaction and denied lines', () => {
  const base = {
    id: 'audit-the-router-9x2a',
    agyStatus: 'SUCCESS',
    exitCode: 0,
    conversationId: 'b8b3e36f-3fb0-4d55-a0ee-8a839b4b0fe4',
    summary: 'Done.\n',
  };

  it('says how many times agy compacted its context', () => {
    expect(renderResult({ ...base, compactions: 2 })).toContain(
      '⚠ agy compacted its context 2 times during this run; check the diff against the brief',
    );
  });

  it('singularises one compaction', () => {
    expect(renderResult({ ...base, compactions: 1 })).toContain('compacted its context 1 time ');
  });

  it('stays silent when nothing was compacted', () => {
    expect(renderResult({ ...base, compactions: 0 })).toBe('Done.\n');
    expect(renderResult(base)).toBe('Done.\n');
  });

  it('lists the actions agy was not allowed to take', () => {
    const out = renderResult({ ...base, deniedActions: ['run_command: rm -rf build'] });
    expect(out).toContain('⚠ agy skipped 1 action it was not allowed to take:');
    expect(out).toContain('run_command: rm -rf build');
  });

  it('stays silent when agy denied nothing, which is every run under --dangerously-skip-permissions', () => {
    expect(renderResult({ ...base, deniedActions: [] })).toBe('Done.\n');
  });

  it('prints compaction before denied, and both before the error line', () => {
    const ids = anomalies({
      ...base,
      agyStatus: 'ERROR',
      error: 'nope',
      compactions: 1,
      deniedActions: ['write_file: /etc/hosts'],
    }).map((a) => a.id);
    expect(ids).toEqual(['agy-status', 'compaction', 'denied', 'agy-error', 'resume']);
  });
});
