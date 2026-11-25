import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STUB_BIN = fileURLToPath(new URL('./fixtures/grok-stub.mjs', import.meta.url));

/** A temp MNGR_GROK_HOME and stub log; restores the environment on cleanup. */
export function sandbox(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cgd-test-'));
  const log = join(dir, 'stub.jsonl');
  const saved = { ...process.env };
  Object.assign(process.env, { MNGR_GROK_HOME: dir, GROK_BIN: STUB_BIN, GROK_STUB_LOG: log, ...env });
  return {
    dir,
    calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []),
    papercuts: () => {
      const p = join(dir, 'papercuts.jsonl');
      return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
    },
    cleanup: () => {
      process.env = saved;
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
    const code = await fn();
    return { code, stdout: out.join(''), stderr: err.join('') };
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
}
