import { afterEach, beforeEach, expect, it } from 'vitest';
import { main } from '../scripts/papercut.mjs';
import { capture, sandbox } from './helpers.mjs';

let box;
beforeEach(() => (box = sandbox()));
afterEach(() => box.cleanup());

it('records a narrated cut, then closes its key', async () => {
  const a = await capture(() => main(['--', '--text', 'grok could not run pytest', '--session', 'abc', '--quote', 'pytest: not found']));
  expect(a.code).toBe(0);
  const b = await capture(() => main(['--resolve', 'narrated', '--note', 'brief now names the venv']));
  expect(b.code).toBe(0);
  const [cut, fix] = box.papercuts();
  expect(cut).toMatchObject({ source: 'narrated', key: 'narrated', sessionId: 'abc', toolVersion: '1.0.92', evidence: { quote: 'pytest: not found' } });
  expect(fix).toMatchObject({ source: 'resolution', resolves: 'narrated' });
});

it('refuses a resolution without a note, and an unknown key', async () => {
  await capture(() => main(['--text', 'x']));
  expect((await capture(() => main(['--resolve', 'narrated']))).code).toBe(2);
  expect((await capture(() => main(['--resolve', 'nope', '--note', 'y']))).code).toBe(2);
});
