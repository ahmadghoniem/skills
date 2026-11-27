import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetBinCache } from '../scripts/lib/codex.mjs';

export const STUB_BIN = fileURLToPath(new URL('./fixtures/codex-stub.mjs', import.meta.url));

const jsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

const MODELS = {
  models: [
    { slug: 'gpt-6.2-sol', visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: ['low', 'medium', 'high'].map((effort) => ({ effort })) },
    { slug: 'gpt-6.2-astra', visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: ['low', 'medium', 'high', 'ultra'].map((effort) => ({ effort })) },
    { slug: 'gpt-reserve', visibility: 'hide', default_reasoning_level: 'medium', supported_reasoning_levels: [] },
  ],
};

/** A temp MNGR_CODEX_HOME and CODEX_HOME (with a model list), and a stub log; restores the environment on cleanup. */
export function sandbox(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mngr-codex-'));
  const codexHome = join(dir, 'codex-home');
  mkdirSync(codexHome);
  writeFileSync(join(codexHome, 'models_cache.json'), JSON.stringify(MODELS));
  const saved = { ...process.env };
  Object.assign(process.env, { MNGR_CODEX_HOME: dir, CODEX_HOME: codexHome, CODEX_BIN: STUB_BIN, CODEX_STUB_LOG: join(dir, 'stub.jsonl'), ...env });
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

export { capture } from '../../opencode/tests/helpers.mjs';
