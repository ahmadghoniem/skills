import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetBinCache } from '../scripts/lib/opencode.mjs';

export const STUB_BIN = fileURLToPath(new URL('./fixtures/opencode-stub.mjs', import.meta.url));

const jsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

/** A temp MNGR_OPENCODE_HOME and stub log; restores the environment on cleanup. */
export function sandbox(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cod-test-'));
  const saved = { ...process.env };
  Object.assign(process.env, { MNGR_OPENCODE_HOME: dir, OPENCODE_BIN: STUB_BIN, OPENCODE_STUB_LOG: join(dir, 'stub.jsonl'), ...env });
  resetBinCache();
  return {
    dir,
    calls: () => jsonl(join(dir, 'stub.jsonl')),
    papercuts: () => jsonl(join(dir, 'papercuts.jsonl')),
    cleanup: () => {
      process.env = saved;
      resetBinCache();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Capture what `fn` writes to stdout and stderr. */
export async function capture(fn) {
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
