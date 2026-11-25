import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main as papercut } from '../scripts/papercut.mjs';
import { main as delegate } from '../scripts/delegate.mjs';

const GROK_STUB = fileURLToPath(new URL('../clis/grok/tests/fixtures/grok-stub.mjs', import.meta.url));
const saved = { ...process.env };
let dir;

async function quiet(fn) {
  const o = process.stdout.write;
  const e = process.stderr.write;
  const err = [];
  process.stdout.write = () => true;
  process.stderr.write = (s) => (err.push(String(s)), true);
  try {
    return { code: await fn(), stderr: err.join('') };
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mngr-test-'));
  Object.assign(process.env, { MNGR_HOME: dir, GROK_BIN: GROK_STUB, GROK_STUB_LOG: join(dir, 'stub.jsonl') });
});
afterEach(() => {
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
});

describe('dispatch', () => {
  it('hands the rest of the arguments to the CLI named first, under ~/.mngr/<cli>', async () => {
    expect((await quiet(() => papercut(['--', 'grok', '--text', 'could not find the tests']))).code).toBe(0);
    const log = join(dir, 'grok', 'papercuts.jsonl');
    expect(existsSync(log)).toBe(true);
    expect(readFileSync(log, 'utf8')).toContain('could not find the tests');
  });

  it('refuses a missing or unknown CLI before running anything', async () => {
    const r = await quiet(() => delegate(['--', 'codex', 'do it']));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('grok, agy, opencode');
    expect((await quiet(() => delegate([]))).code).toBe(2);
    expect(existsSync(join(dir, 'stub.jsonl'))).toBe(false);
  });
});
