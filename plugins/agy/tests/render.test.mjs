import { describe, expect, it } from 'vitest';
import { WANDER_WARNING, anomalies, renderResult } from '../scripts/lib/render.mjs';

describe('renderResult', () => {
  const base = {
    id: 'add-retry-to-fetchuser-a7f3',
    agyStatus: 'SUCCESS',
    exitCode: 0,
    gitRepo: true,
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
      claimedFileChanges: false,
    });
    expect(out).toContain(
      '\u26a0 permission check failed for command "echo SHELLOK": user denied permission to run command:',
    );
    expect(out).toContain('echo SHELLOK');
  });

  it('warns when the report claims writes but the working tree is unchanged', () => {
    const out = renderResult({
      ...base,
      gitFiles: [],
      claimedFileChanges: true,
      summary: 'Created [touched.txt](file:///C:/tmp/touched.txt) containing `OK`.\n',
    });
    expect(out).toContain(WANDER_WARNING);
    expect(out).toContain('antigravity-cli/scratch');
  });

  it('does not cry wander outside a git repo, where there is no tree to compare', () => {
    const out = renderResult({
      ...base,
      gitRepo: false,
      gitFiles: [],
      claimedFileChanges: true,
    });
    expect(out).not.toContain(WANDER_WARNING);
  });

  it('reports a watchdog kill', () => {
    const out = renderResult({ ...base, killed: true });
    expect(out).toContain('\u26a0 watchdog killed the run');
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
        gitRepo: true,
        gitFiles: [{ status: 'M', path: 'a.ts' }],
        summary: 'done',
        claimedFileChanges: true,
      }),
    ).toEqual([]);
  });

  it('treats a missing status as unremarkable rather than a failure', () => {
    expect(anomalies({ id: 'x', agyStatus: null, exitCode: 0, gitRepo: false })).toEqual([]);
  });
});
