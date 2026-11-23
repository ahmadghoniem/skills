#!/usr/bin/env node
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import {
  cachedModels,
  installPlugin,
  listModels,
  PLUGIN_NAME,
  refreshModelCache,
  resolveBin,
  writeModelCache,
} from './lib/agy.mjs';
import { run } from './lib/run.mjs';
import { compareVersions, reviewedAgyVersion } from './update.mjs';

const INSTALL_HINT =
  'Install the Antigravity CLI so `agy` is on PATH (or at %LOCALAPPDATA%\\agy\\bin\\agy.exe), or set AGY_BIN to its full path.\n' +
  'Then re-run `/agy:setup`.';

/**
 * Whether `agy --version` output is at least `min`, the version the plugin was
 * last reviewed against. Output with no version number passes.
 *
 * @param {string} text
 * @param {string|null} [min]
 * @returns {boolean}
 */
export function versionOk(text, min = reviewedAgyVersion()) {
  const v = /\d+\.\d+\.\d+/.exec(text)?.[0];
  return !v || !min || compareVersions(v, min) >= 0;
}

/**
 * Print the model ids agy accepts, one per line, for `commands/delegate.md` to
 * embed. Reads `cachedModels()`, and refreshes the cache only when it is
 * missing or empty.
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
  for (const m of models) process.stdout.write(`${m.id}\n`);
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
  if (!versionOk(versionText)) {
    lines.push(`- ✗ version: ${versionText}; the plugin needs agy ${reviewedAgyVersion()} or newer. Run \`/agy:update\`.`);
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
  writeModelCache(models, versionText, bin);
  lines.push(`- ✓ model cache refreshed (${models.length} models)`);

  try {
    const state = await installPlugin(bin);
    lines.push(`- ✓ agy plugin \`${PLUGIN_NAME}\` ${state}: the bash-delegate agent and its bash tool`);
  } catch (err) {
    lines.push(`- ✗ agy plugin: ${err instanceof Error ? err.message : String(err)}`);
    process.stdout.write(lines.join('\n') + '\n');
    return 1;
  }
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
