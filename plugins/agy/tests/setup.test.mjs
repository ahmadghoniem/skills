import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { main } from '../scripts/setup.mjs';
import { STUB_BIN } from './helpers.mjs';

const saved = { ...process.env };
let home;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cad-setup-'));
  Object.assign(process.env, { CAD_HOME: home, AGY_BIN: STUB_BIN });
});
afterEach(() => {
  process.env = { ...saved };
  rmSync(home, { recursive: true, force: true });
});

it('checks the binary, the version and the agy plugin', async () => {
  const out = [];
  const w = process.stdout.write;
  process.stdout.write = (s) => (out.push(String(s)), true);
  try {
    expect(await main()).toBe(0);
  } finally {
    process.stdout.write = w;
  }
  const text = out.join('');
  expect(text).toContain('✓ version 1.5.14');
  expect(text).toContain('✓ agy plugin `agy` installed');
});
