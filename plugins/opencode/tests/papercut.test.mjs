import { afterEach, expect, it } from 'vitest';
import { main } from '../scripts/papercut.mjs';
import { capture, sandbox } from './helpers.mjs';

let box;
afterEach(() => box.cleanup());

it('records a narrated cut with the opencode version, and closes it by key', async () => {
  box = sandbox();
  expect((await capture(() => main(['--text', 'could not find the tests', '--session', 'ses_1']))).code).toBe(0);
  expect(box.papercuts()[0]).toEqual(expect.objectContaining({ key: 'narrated', toolVersion: '2.0.32', sessionId: 'ses_1' }));
  expect((await capture(() => main(['--resolve', 'narrated', '--note', 'brief names the test dir']))).code).toBe(0);
  expect(box.papercuts()[1]).toEqual(expect.objectContaining({ resolves: 'narrated' }));
});
