import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../scripts/delegate.mjs';
import { capture, sandbox } from './helpers.mjs';

let box;
beforeEach(() => {
  box = sandbox({ CLAUDECODE: '1' });
});
afterEach(() => box.cleanup());

const at = (args, flag) => args[args.indexOf(flag) + 1];

describe('/mngr:delegate codex', () => {
  it('prints the session as it starts, then the write-up, and files codex notes', async () => {
    const r = await capture(() => main(['do the thing']));
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('model: gpt-6.2-sol (codex) · session: 01a2-thread-0001\nDone.\n\nsession: 01a2-thread-0001\n');
    expect(box.papercuts()).toEqual([expect.objectContaining({ key: 'note', text: 'Model metadata for `x` not found.', toolVersion: '0.172.0' })]);
  });

  it('sends the brief on stdin, bypasses approvals, and pins the model default effort', async () => {
    await capture(() => main(['--model', 'gpt-6.2-astra', 'do the thing']));
    const [call] = box.calls();
    expect(call.args.slice(0, 1)).toEqual(['exec']);
    expect(call.args).toEqual(expect.arrayContaining(['--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check']));
    expect(at(call.args, '-m')).toBe('gpt-6.2-astra');
    expect(at(call.args, '-c')).toBe('model_reasoning_effort=low');
    expect(call.args.at(-1)).toBe('-');
    expect(call.stdin).toMatch(/^do the thing\n\n---\nNobody can answer/);
    expect(call.CLAUDECODE).toBeNull();
  });

  it('passes an effort the model takes, and refuses one it does not, before starting codex', async () => {
    await capture(() => main(['--model', 'gpt-6.2-astra', '--effort', 'ultra', 'x']));
    expect(at(box.calls()[0].args, '-c')).toBe('model_reasoning_effort=ultra');
    const r = await capture(() => main(['--model', 'gpt-6.2-sol', '--effort', 'ultra', 'x']));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('gpt-6.2-sol takes --effort low, medium, high (its default: low)');
    expect(box.calls()).toHaveLength(1);
  });

  it('refuses a model codex does not list, hidden ones included', async () => {
    const r = await capture(() => main(['--model', 'gpt-reserve', 'x']));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('codex has no model `gpt-reserve`.');
    expect(box.calls()).toEqual([]);
  });

  it('continues a session with exec resume and only the follow-up', async () => {
    const r = await capture(() => main(['--session', 'abc-123', 'one more thing']));
    const [call] = box.calls();
    expect(call.args.slice(0, 3)).toEqual(['exec', 'resume', 'abc-123']);
    expect(call.args).not.toContain('-m');
    expect(call.stdin).toBe('one more thing');
    expect(r.stdout).toMatch(/^model: kept from the session \(codex\) · session: abc-123\n/);
  });

  it('shows why a turn failed and exits 1', async () => {
    process.env.CODEX_STUB_MODE = 'error';
    const r = await capture(() => main(['x']));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("⚠ error: You've hit your usage limit. Try again in 3 hours.");
    expect(box.papercuts()[0]).toMatchObject({ key: 'error-detail' });
  });

  it('falls back to the end of stderr when codex prints no JSON', async () => {
    process.env.CODEX_STUB_MODE = 'crash';
    const r = await capture(() => main(['x']));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('⚠ exit 2');
    expect(r.stdout).toContain('⚠ error: error: unexpected argument --bogus');
  });
});
