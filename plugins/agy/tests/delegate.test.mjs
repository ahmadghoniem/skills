// delegate.mjs against the stubbed agy binary, never the real CLI.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_STDIN_BYTES } from '../scripts/lib/agy.mjs';
import { main } from '../scripts/delegate.mjs';
import { STUB_BIN } from './helpers.mjs';

const saved = { ...process.env };
const prevCwd = process.cwd();
let home;
let repo;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cad-delegate-'));
  repo = mkdtempSync(join(tmpdir(), 'cad-delegate-repo-'));
  Object.assign(process.env, {
    CAD_HOME: home,
    AGY_BIN: STUB_BIN,
    CLAUDECODE: '1',
    AGY_STUB_ARGV: join(home, 'argv.json'),
    AGY_STUB_STDIN: join(home, 'stdin.txt'),
    AGY_STUB_ENV: join(home, 'env.json'),
  });
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(prevCwd);
  process.env = { ...saved };
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

/** The stub replays these events; `exit` is its exit code. */
function fixture(events, { exit = 0, stderr } = {}) {
  const path = join(home, 'fixture.ndjson');
  writeFileSync(path, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  process.env.AGY_STUB_FIXTURE = path;
  process.env.AGY_STUB_EXIT = String(exit);
  if (stderr) process.env.AGY_STUB_STDERR = stderr;
}

const result = (r) => ({ event: 'result', result: r });
const CONV = 'c0ffee00-0000-4000-8000-000000000000';
const read = (name) => readFileSync(join(home, name), 'utf8');

async function capture(fn) {
  const out = [];
  const err = [];
  const o = process.stdout.write;
  const e = process.stderr.write;
  process.stdout.write = (s) => (out.push(String(s)), true);
  process.stderr.write = (s) => (err.push(String(s)), true);
  try {
    return { code: await fn(), stdout: out.join(''), stderr: err.join('') };
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
}

describe('delegate.mjs', () => {
  it('prints the report and the conversation id, and exits 0 on a clean run', async () => {
    fixture([result({ status: 'SUCCESS', conversation_id: CONV, response: 'All done.' })]);
    const r = await capture(() => main(['do the thing']));
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`All done.\n\nconversation: ${CONV}\n`);
  });

  it('runs a fresh task on bash-delegate with the default model, in the workspace', async () => {
    fixture([result({ status: 'SUCCESS', conversation_id: CONV, response: 'ok' })]);
    await capture(() => main(['do the thing']));
    const argv = JSON.parse(read('argv.json'));
    expect(argv).toEqual(expect.arrayContaining(['--add-dir', '--agent', 'bash-delegate', '--model', 'gemini-4-hydrogen-medium', '--dangerously-skip-permissions']));
    expect(argv).not.toContain('--continue');
    const stdin = JSON.parse(read('stdin.txt'));
    expect(stdin.message.content).toMatch(/^OS: Windows[\s\S]*Git repository: false[\s\S]*# Task\n\ndo the thing$/);
  });

  it('starts agy without CLAUDECODE and with auto-update off', async () => {
    fixture([result({ status: 'SUCCESS', conversation_id: CONV, response: 'ok' })]);
    await capture(() => main(['x']));
    expect(JSON.parse(read('env.json'))).toEqual({ CLAUDECODE: null, AGY_CLI_DISABLE_AUTO_UPDATE: 'true' });
  });

  it('continues a conversation with only the follow-up, no workspace and no agent', async () => {
    fixture([result({ status: 'SUCCESS', conversation_id: CONV, response: 'ok' })]);
    await capture(() => main(['--conversation', CONV, 'one more thing']));
    const argv = JSON.parse(read('argv.json'));
    expect(argv).toEqual(expect.arrayContaining(['--conversation', CONV]));
    expect(argv).not.toContain('--add-dir');
    expect(argv).not.toContain('--agent');
    expect(JSON.parse(read('stdin.txt')).message.content).toBe('one more thing');
  });

  it('exits 1 on agy status ERROR even with exit 0, and says whether a write-up came back', async () => {
    fixture([result({ status: 'ERROR', conversation_id: CONV, response: 'did some', error: 'refused write' })]);
    const r = await capture(() => main(['x']));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('⚠ agy status: ERROR (write-up present)');
    expect(r.stdout).toContain('⚠ refused write');
  });

  it('shows stderr only on a run that failed', async () => {
    fixture([result({ status: 'SUCCESS', conversation_id: CONV, response: 'ok' })], { stderr: 'a background note' });
    expect((await capture(() => main(['x']))).stdout).not.toContain('stderr');
    fixture([], { exit: 1, stderr: 'not signed in' });
    const r = await capture(() => main(['x']));
    expect(r.stdout).toContain('⚠ agy wrote to stderr:\n  not signed in');
    expect(r.code).toBe(1);
  });

  it('reports finished_reason verbatim, print_timeout included', async () => {
    fixture([result({ status: 'SUCCESS', conversation_id: CONV, response: 'partial', finished_reason: 'print_timeout' })]);
    const r = await capture(() => main(['x']));
    expect(r.stdout).toContain('⚠ agy ended the turn early: finished_reason print_timeout');
    expect(r.code).toBe(1);
  });

  it('lists the valid model ids when agy rejects the model', async () => {
    fixture([result({ status: 'ERROR', response: '', error: 'invalid model selection (--model "nope"): model not recognized' })], { exit: 1 });
    const r = await capture(() => main(['--model', 'nope', 'x']));
    expect(r.stdout).toContain('Valid ids:\n    gemini-3.7-flash-high');
  });

  it('files failed tool calls as papercuts without printing them', async () => {
    fixture([
      { event: 'step_update', step_update: { step_type: 'tool', step_index: 1, tool_name: 'view_file', state: 'ERROR', tool_info: { error: { message: 'file does not exist' } } } },
      result({ status: 'SUCCESS', conversation_id: CONV, response: 'ok' }),
    ]);
    const r = await capture(() => main(['x']));
    expect(r.stdout).not.toContain('tool');
    const rows = read('papercuts.jsonl').trim().split('\n').map((l) => JSON.parse(l));
    expect(rows).toEqual([expect.objectContaining({ key: 'tool-errors:view_file', text: 'file does not exist', toolVersion: '1.5.14' })]);
  });

  it('refuses a model whose quota resets later, before starting agy, until a run gets through', async () => {
    fixture([result({ status: 'ERROR', response: '', error: 'Individual quota reached. Resets in 3h25m10s.' })], { exit: 1 });
    await capture(() => main(['x']));
    rmSync(join(home, 'argv.json'));
    const r = await capture(() => main(['x']));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('agy refused gemini-4-hydrogen-medium before starting: "Individual quota reached.');
    expect(() => read('argv.json')).toThrow();
    fixture([result({ status: 'SUCCESS', conversation_id: CONV, response: 'ok' })]);
    expect((await capture(() => main(['--model', 'gemini-4-neon-high', 'x']))).code).toBe(0);
  });

  it('refuses bad input before starting agy', async () => {
    expect((await capture(() => main(['--effort', 'high', 'x']))).code).toBe(2);
    expect((await capture(() => main([]))).code).toBe(2);
    expect((await capture(() => main(['--prompt-file', join(home, 'missing.md')]))).code).toBe(2);
    expect((await capture(() => main(['x'.repeat(MAX_STDIN_BYTES + 1)]))).code).toBe(2);
    expect(() => read('argv.json')).toThrow();
  });

  it('reads the brief from --prompt-file', async () => {
    fixture([result({ status: 'SUCCESS', conversation_id: CONV, response: 'ok' })]);
    const brief = join(home, 'brief.md');
    writeFileSync(brief, '# Goal\nRename it.\n');
    await capture(() => main(['--', '--prompt-file', brief]));
    expect(JSON.parse(read('stdin.txt')).message.content).toContain('# Goal\nRename it.');
  });
});
