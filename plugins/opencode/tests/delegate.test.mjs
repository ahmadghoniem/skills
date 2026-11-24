import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, main } from '../scripts/delegate.mjs';
import { SIDECAR_MESSAGE } from '../scripts/lib/opencode.mjs';
import { capture, sandbox } from './helpers.mjs';

let box;
beforeEach(() => {
  box = sandbox({ CLAUDECODE: '1' });
});
afterEach(() => box.cleanup());

describe('delegate.mjs', () => {
  it('prints the write-up and the session id, and files tools that could not run', async () => {
    const r = await capture(() => main(['do the thing']));
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^Done\.\n\nsession: ses_[0-9a-f]{26}\n$/);
    expect(box.papercuts()).toEqual([expect.objectContaining({ key: 'tool-errors:read', text: 'File not found: a.txt', toolVersion: '2.4.1' })]);
  });

  it('always passes a model, names the session up front, and attaches the brief', async () => {
    await capture(() => main(['do the thing']));
    const [call] = box.calls();
    expect(call.args[0]).toBe('run');
    expect(call.args).toEqual(expect.arrayContaining(['--standalone', '--dangerously-skip-permissions']));
    expect(call.args[call.args.indexOf('--format') + 1]).toBe('json');
    expect(call.args[call.args.indexOf('--model') + 1]).toBe(DEFAULT_MODEL);
    expect(call.args[call.args.indexOf('--session') + 1]).toMatch(/^ses_/);
    expect(call.args.slice(-2)).toEqual(['--', SIDECAR_MESSAGE]);
    expect(call.args).not.toContain('--continue');
    expect(call.brief).toBe('do the thing');
    expect(call.CLAUDECODE).toBeNull();
  });

  it('continues a session it is given', async () => {
    const r = await capture(() => main(['--session', 'ses_abc', '--model', 'nebius/x', 'more']));
    const [call] = box.calls();
    expect(call.args[call.args.indexOf('--session') + 1]).toBe('ses_abc');
    expect(call.args[call.args.indexOf('--model') + 1]).toBe('nebius/x');
    expect(r.stdout).toContain('session: ses_abc');
  });

  it('shows opencode error events and exits 1', async () => {
    box.cleanup();
    box = sandbox({ OPENCODE_STUB_MODE: 'error' });
    const r = await capture(() => main(['x']));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('⚠ exit 1\n⚠ error: provider.quota: Free usage limit reached.');
    expect(box.papercuts()[0]).toEqual(expect.objectContaining({ key: 'error-detail' }));
  });

  it('falls back to the end of stderr when opencode printed no events', async () => {
    box.cleanup();
    box = sandbox({ OPENCODE_STUB_MODE: 'crash' });
    const r = await capture(() => main(['x']));
    expect(r.stdout).toContain('⚠ error: boot\n    Error: Location plugins did not finish activating');
  });

  it('reads --prompt-file and refuses bad input before starting opencode', async () => {
    const brief = join(box.dir, 'brief.md');
    writeFileSync(brief, '# Goal\n');
    await capture(() => main(['--prompt-file', brief]));
    expect(box.calls()[0].brief).toBe('# Goal\n');
    expect((await capture(() => main([]))).code).toBe(2);
    expect((await capture(() => main(['--session', 'abc', 'x']))).code).toBe(2);
    expect((await capture(() => main(['--prompt-file', brief, 'x']))).code).toBe(2);
    expect((await capture(() => main(['--nope']))).code).toBe(2);
    expect(box.calls()).toHaveLength(1);
  });
});
