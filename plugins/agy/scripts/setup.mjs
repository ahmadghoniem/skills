#!/usr/bin/env node
import { invokedAsScript, parseCommandArgv } from './lib/util/args.mjs';
import {
  listModels,
  modelEncodesEffort,
  parseModelList,
  readAccountDefaultLabel,
  resolveBin,
  cachedToolVersion,
  writeModelCache,
} from './lib/agy.mjs';
import { run } from './lib/util/run.mjs';

const INSTALL_HINT =
  'Install the Antigravity CLI so `agy` is on PATH (or at %LOCALAPPDATA%\\agy\\bin\\agy.exe), or set AGY_BIN to its full path.\n' +
  'Then re-run `/agy:setup`.';

/**
 * Print just the TSV (id TAB label), one model per line, for `/agy:delegate`
 * to feed into AskUserQuestion. Marks models whose id already encodes effort.
 *
 * @returns {Promise<number>}
 */
async function printModels() {
  let bin;
  try {
    bin = await resolveBin();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write(INSTALL_HINT + '\n');
    return 1;
  }
  const res = await run(bin, ['models'], { timeoutMs: 10_000 });
  if (res.exitCode !== 0) {
    process.stderr.write(`${res.stderr || res.stdout || 'agy models failed'}\n`);
    return 1;
  }
  const models = parseModelList(res.stdout);
  if (models.length === 0) {
    process.stderr.write('Could not parse model list from `agy models`.\n');
    return 1;
  }
  const defaultLabel = readAccountDefaultLabel();
  // Refreshes the cache after the live fetch, preserving the cached toolVersion.
  writeModelCache(models, defaultLabel, cachedToolVersion());
  for (const m of models) {
    const effort = modelEncodesEffort(m.id) ? 'effort-in-id' : 'effort-flag';
    const def = defaultLabel && m.label === defaultLabel ? '\tdefault' : '';
    process.stdout.write(`${m.id}\t${m.label}\t${effort}${def}\n`);
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
  if (models.length === 0) {
    lines.push('- ✗ no models reported');
    process.stdout.write(lines.join('\n') + '\n');
    return 1;
  }
  const defaultLabel = readAccountDefaultLabel();
  // Sole writer of the model cache. Dispatch reads this cache without fetching.
  writeModelCache(models, defaultLabel, versionText);
  lines.push(`- ✓ model cache refreshed (${models.length} models)`);
  lines.push('- models:');
  for (const m of models) {
    const bits = [];
    if (defaultLabel && m.label === defaultLabel) bits.push('account default');
    if (modelEncodesEffort(m.id)) bits.push('effort in id');
    const suffix = bits.length ? ` (${bits.join(', ')})` : '';
    lines.push(`  - \`${m.id}\` — ${m.label}${suffix}`);
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
