import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../scripts/delegate.mjs';
import { capture, sandbox } from './helpers.mjs';

let box;
beforeEach(() => {
  box = sandbox({ CLAUDECODE: '1' });
});
afterEach(() => box.cleanup());

describe('/mngr:delegate grok', () => {
  it('prints the write-up and the session id, and names the session before the run', async () => {
    const brief = join(box.dir, 'brief.md');
    writeFileSync(brief, '# Goal\nRename X to Y.\n');
    const r = await capture(() => main(['--', '--prompt-file', brief]));
    expect(r.code).toBe(0);
    const [call] = box.calls();
    const session = call.args[call.args.indexOf('-s') + 1];
    expect(session).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.stdout).toBe(`model: grok's default (grok) · session: ${session}\nDone: renamed X to Y.\n\nsession: ${session}\n`);
    expect(call.args).toEqual(expect.arrayContaining(['--output-format', 'json', '--trust', '--no-auto-update']));
    expect(call.args).toContain('--reasoning-effort');
    expect(call.brief).toContain('Rename X to Y.');
    expect(call.brief).toContain('Nobody can answer questions during this run');
  });

  it('runs grok without CLAUDECODE and with the Claude sources off', async () => {
    await capture(() => main(['inline task']));
    const [call] = box.calls();
    expect(call.CLAUDECODE).toBeNull();
    expect(call.hooks).toBe('false');
  });

  it('passes an inline task through a temp file it deletes afterwards', async () => {
    await capture(() => main(['--effort', 'low', 'Rename', 'X']));
    const [call] = box.calls();
    const file = call.args[call.args.indexOf('--prompt-file') + 1];
    expect(call.brief).toMatch(/^Rename X\n\n---\nNobody can answer/);
    expect(existsSync(file)).toBe(false);
  });

  it('continues a session with --resume and no -s', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const r = await capture(() => main(['--session', id, 'one more thing']));
    const [call] = box.calls();
    expect(call.args).toContain('--resume');
    expect(call.args).not.toContain('-s');
    expect(r.stdout).toMatch(new RegExp(`^model: kept from the session \\(grok\\) · session: ${id}\\n`));
    expect(call.brief).toBe('one more thing');
  });

  it('shows grok error with the wrapped provider message, exits 1 and files a papercut', async () => {
    process.env.GROK_STUB_MODE = 'error';
    const r = await capture(() => main(['task']));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('⚠ exit 1');
    expect(r.stdout).toContain('⚠ error: Internal error: API error (status 402 Payment Required): Grok Build usage balance exhausted');
    const [cut] = box.papercuts();
    expect(cut).toMatchObject({ source: 'detected', key: 'error-detail', toolVersion: '1.0.92' });
  });

  it('falls back to the end of stderr when grok prints no JSON', async () => {
    process.env.GROK_STUB_MODE = 'crash';
    const r = await capture(() => main(['task']));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('⚠ exit 2');
    expect(r.stdout).toContain('⚠ error: warning: something noisy');
    expect(r.stdout).toContain('    Error: unexpected argument --bogus');
  });

  it('reports a stop reason other than end_turn', async () => {
    process.env.GROK_STUB_MODE = 'max_tokens';
    const r = await capture(() => main(['task']));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('⚠ stop reason: max_tokens');
  });

  it('refuses bad input before starting grok', async () => {
    expect((await capture(() => main(['--effort', 'high', 'x']))).code).toBe(2);
    expect((await capture(() => main([]))).code).toBe(2);
    expect((await capture(() => main(['--bogus', 'x']))).code).toBe(2);
    expect((await capture(() => main(['--prompt-file', join(box.dir, 'none.md')]))).code).toBe(2);
    expect(box.calls()).toEqual([]);
  });
});
