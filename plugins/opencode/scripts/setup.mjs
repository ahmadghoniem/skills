#!/usr/bin/env node
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { readConfig } from './lib/config.mjs';
import { listModels, refreshModelCache, resolveBin } from './lib/opencode.mjs';
import { run } from './lib/run.mjs';

/**
 * `opencode auth list` draws a box with ANSI colour. Strip the escapes and the
 * box-drawing glyphs so the health check reads as plain text.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function cleanAuthOutput(text) {
  return String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001B\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[┌│└├─●]+\s?/u, '').trimEnd())
    .filter((line) => line.trim().length > 0);
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { flags } = parseCommandArgv(rawArgv, ['print-models', 'refresh']);
  /** @type {string[]} */
  const out = [];
  let failed = false;

  /** @type {string|null} */
  let bin = null;
  try {
    bin = await resolveBin();
    out.push(`binary: ${bin}`);
  } catch (err) {
    out.push(`binary: NOT FOUND — ${err instanceof Error ? err.message : String(err)}`);
    process.stdout.write(`${out.join('\n')}\n`);
    return 1;
  }

  const ver = await run(bin, ['--version'], { timeoutMs: 10_000 });
  const version = `${ver.stdout}${ver.stderr}`.trim();
  if (ver.exitCode === 0 && version) {
    out.push(`version: ${version}`);
  } else {
    out.push('version: could not be read');
    failed = true;
  }

  const auth = await run(bin, ['auth', 'list'], { timeoutMs: 20_000 });
  const authLines = cleanAuthOutput(`${auth.stdout}${auth.stderr}`);
  if (authLines.length > 0) {
    out.push('', 'providers:', ...authLines.map((l) => `  ${l}`));
  } else {
    out.push('', 'providers: none reported — run `opencode auth login`');
    failed = true;
  }

  /** @type {import('./lib/opencode.mjs').ModelInfo[]} */
  let models = [];
  try {
    models = flags['refresh'] ? await refreshModelCache() : await listModels();
    const free = models.filter((m) => m.free).length;
    const providers = new Set(models.map((m) => m.provider)).size;
    out.push('', `models: ${models.length} across ${providers} providers (${free} free)`);
  } catch (err) {
    out.push('', `models: ${err instanceof Error ? err.message : String(err)}`);
    failed = true;
  }

  const config = readConfig();
  out.push('');
  if (config.models.length === 0) {
    out.push(
      'allowlist: EMPTY — no delegation can run yet.',
      '  `opencode run` picks a model on its own when none is named, and that model may',
      '  be metered, so this plugin refuses to dispatch until the allowed set is stated.',
      '  See the live list with /opencode:models, then /opencode:models --allow <id>.',
    );
    failed = true;
  } else {
    out.push(`allowlist: ${config.models.join(', ')}`);
    out.push(`default: ${config.default ?? '(none set — pass --model, or /opencode:models --default <id>)'}`);
  }

  if (flags['print-models'] && models.length > 0) {
    out.push('', 'available models:');
    for (const m of models) out.push(`  ${m.id}${m.free ? '  (free)' : ''}`);
  }

  process.stdout.write(`${out.join('\n')}\n`);
  return failed ? 1 : 0;
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`setup failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
