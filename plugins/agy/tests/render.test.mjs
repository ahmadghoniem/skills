import { describe, expect, it } from 'vitest';
import { anomalies, renderResult } from '../scripts/lib/render.mjs';

describe('renderResult', () => {
  const base = {
    id: 'add-retry-to-fetchuser-a7f3',
    agyStatus: 'SUCCESS',
    exitCode: 0,
    gitFiles: [
      { status: 'M', path: 'src/api/user.ts' },
      { status: 'A', path: 'src/api/user.test.ts' },
    ],
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

  it('measures the ERROR so a blip is distinguishable from a dead run', () => {
    // The case that motivated this: a provider stream interrupted in the last
    // second of a run whose work had already landed.
    expect(renderResult({ ...base, agyStatus: 'ERROR' })).toContain(
      '\u26a0 agy status: ERROR (write-up present, 2 files changed)',
    );
    // And the case it must not read the same as.
    expect(
      renderResult({ ...base, agyStatus: 'ERROR', summary: '', gitFiles: [] }),
    ).toContain('\u26a0 agy status: ERROR (no write-up, 0 files changed)');
  });

  it('singularises one file', () => {
    expect(
      renderResult({ ...base, agyStatus: 'ERROR', gitFiles: [{ status: 'M', path: 'a.ts' }] }),
    ).toContain('(write-up present, 1 file changed)');
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
      gitFiles: [],
      error:
        'permission check failed for command "echo SHELLOK": user denied permission to run command:\necho SHELLOK',
      summary: '',
    });
    expect(out).toContain(
      '\u26a0 permission check failed for command "echo SHELLOK": user denied permission to run command:',
    );
    expect(out).toContain('echo SHELLOK');
  });

  it('reports a watchdog kill', () => {
    const out = renderResult({ ...base, killed: true });
    expect(out).toContain('\u26a0 watchdog killed the run');
  });

  it('offers a resume only on a killed run that captured a conversation id', () => {
    const killed = renderResult({ ...base, killed: true });
    expect(killed).toContain(
      '\u26a0 this run can be resumed where it stopped: /agy:resume add-retry-to-fetchuser-a7f3',
    );

    // A run that finished has nothing to resume, however it ended.
    expect(renderResult({ ...base, agyStatus: 'ERROR', exitCode: 1 })).not.toContain(
      '/agy:resume',
    );
    // No id captured means the line would point at nothing.
    expect(renderResult({ ...base, killed: true, conversationId: undefined })).not.toContain(
      '/agy:resume',
    );
  });

  it('says so when agy returned nothing at all', () => {
    expect(renderResult({ ...base, summary: '' })).toBe('(agy returned no report)\n');
  });
});

describe('anomalies', () => {
  it('is empty for a clean run', () => {
    expect(
      anomalies({
        id: 'x',
        agyStatus: 'SUCCESS',
        exitCode: 0,
        gitFiles: [{ status: 'M', path: 'a.ts' }],
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
    gitFiles: [{ status: 'M', path: 'src/a.ts' }],
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
    expect(out).toContain('agy produced no result. Its stderr:');
    expect(out).toContain('  authentication required');
    expect(out).toContain('  run `agy login`');
  });

  it('stays silent when agy DID produce a write-up', () => {
    // A working run that happened to write to stderr must not gain a line —
    // that noise is exactly what the quiet-by-default contract suppresses.
    const out = renderResult({
      id: 'x-3333',
      agyStatus: 'SUCCESS',
      exitCode: 0,
      summary: 'Done.\n',
      stderrTail: ['warning: something chatty'],
    });
    expect(out).toBe('Done.\n');
  });

  it('stays silent when agy reported a status, even a failing one', () => {
    // A real ERROR result already explains itself through `error`; the stderr
    // dump is reserved for the case where nothing else can speak.
    const out = renderResult({
      id: 'x-4444',
      agyStatus: 'ERROR',
      exitCode: 1,
      summary: '',
      error: 'the actual reason',
      stderrTail: ['some unrelated chatter'],
    });
    expect(out).not.toContain('produced no result');
    expect(out).toContain('the actual reason');
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
      '⚠ agy status: ERROR (no write-up, 0 files changed)\n⚠ exit 1\n⚠ one line only\n',
    );
  });
});
