import { afterEach, beforeEach, expect, it } from 'vitest';
import { main } from '../scripts/setup.mjs';
import { capture, sandbox } from './helpers.mjs';

let box;
beforeEach(() => (box = sandbox()));
afterEach(() => box.cleanup());

it('reports the binary, version and sign-in, without a model list', async () => {
  const r = await capture(() => main());
  expect(r.code).toBe(0);
  expect(r.stdout).toContain('✓ version 1.0.92');
  expect(r.stdout).toContain('✓ You are logged in with grok.com');
  expect(r.stdout).not.toContain('grok-4.7');
});
