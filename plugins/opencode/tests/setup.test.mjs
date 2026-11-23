import { afterEach, expect, it } from 'vitest';
import { main } from '../scripts/setup.mjs';
import { capture, sandbox } from './helpers.mjs';

let box;
afterEach(() => box.cleanup());

it('reports the binary and the version', async () => {
  box = sandbox();
  const r = await capture(() => main());
  expect(r.code).toBe(0);
  expect(r.stdout).toContain('✓ version 2.0.32');
});
