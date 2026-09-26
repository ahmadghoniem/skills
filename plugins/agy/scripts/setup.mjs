#!/usr/bin/env node
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import {
  cachedModels,
  familyLevels,
  listModels,
  readAccountDefaultLabel,
  refreshModelCache,
  resolveBin,
  writeModelCache,
} from './lib/agy.mjs';
import { run } from './lib/run.mjs';

const INSTALL_HINT =
  'Install the Antigravity CLI so `agy` is on PATH (or at %LOCALAPPDATA%\\agy\\bin\\agy.exe), or set AGY_BIN to its full path.\n' +
  'Then re-run `/agy:setup`.';

/** Effort levels in the order they print, when a family has any. */
const LEVEL_ORDER = ['low', 'medium', 'high'];

/**
 * Format one family's levels for the table: a comma-joined list, or `none`
 * when the family's ids carry no effort suffix at all.
 *
 * @param {Set<string>} levels
 * @returns {string}
 */
function formatLevels(levels) {
  if (!levels || levels.size === 0) return 'none';
  return LEVEL_ORDER.filter((l) => levels.has(l)).join(', ');
}

/**
 * Print a family/levels table (`family<TAB>levels|none`, one line per
 * family) for `commands/delegate.md` to embed and `/agy:delegate` to read.
 * Reads `cachedModels()`, and refreshes the cache only when it is missing or
 * empty.
 *
 * @returns {Promise<number>}
 */
async function printModels() {
  let models = cachedModels();
  if (!models?.length) {
    try {
      models = await refreshModelCache();
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.stderr.write(INSTALL_HINT + '\n');
      return 1;
    }
  }
  for (const [family, levels] of familyLevels(models)) {
    process.stdout.write(`${family}\t${formatLevels(levels)}\n`);
  }
  return 0;
}

/**
 * @returns {Promise<number>}
 */
async function baseCheck() {
  const lines = ['### /agy:setup\n'];
  let bin;
  try {
    bin = await resolveBin();
  } catch (err) {
    lines.push(`- ✗ ${err instanceof Error ? err.message : String(err)}`);
    lines.push('');
    lines.push(INSTALL_HINT);
    process.stdout.write(lines.join('\n') + '\n');
    return 1;
  }
  lines.push(`- ✓ agy at \`${bin}\``);

  const ver = await run(bin, ['--version'], { timeoutMs: 5_000 });
  const versionText = `${ver.stdout}${ver.stderr}`.trim() || '(no output)';
  if (ver.exitCode !== 0) {
    lines.push(`- ✗ version: ${versionText}`);
    process.stdout.write(lines.join('\n') + '\n');
    return 1;
  }
  lines.push(`- ✓ version: ${versionText}`);

  let models;
  try {
    models = await listModels();
  } catch (err) {
    lines.push(`- ✗ models: ${err instanceof Error ? err.message : String(err)}`);
    process.stdout.write(lines.join('\n') + '\n');
    return 1;
  }
  const defaultLabel = readAccountDefaultLabel();
  // One writer among several: `delegate.mjs`'s weekly, cache-miss, and
  // rejected-model refreshes also call `writeModelCache`. Dispatch reads
  // this cache without fetching.
  writeModelCache(models, defaultLabel, versionText, bin);
  lines.push(`- ✓ model cache refreshed (${models.length} models)`);
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { flags } = parseCommandArgv(rawArgv, ['print-models']);
  if (flags['print-models'] || flags['printModels']) return printModels();
  return baseCheck();
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`setup failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
