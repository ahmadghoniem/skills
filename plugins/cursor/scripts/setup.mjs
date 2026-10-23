#!/usr/bin/env node
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { aboutInfo, parseModelList, resolveBin } from './lib/cursor.mjs';
import { run } from './lib/run.mjs';

const INSTALL_HINT =
  'Install the Cursor CLI (it lands in %LOCALAPPDATA%\\cursor-agent on Windows), or set CURSOR_AGENT_BIN to its full path.\n' +
  'Then run `cursor-agent login` and re-run `/cursor:setup`.';

/**
 * `cursor-agent status` prints "✓ Logged in as <email>" when signed in. The
 * address is the user's and stays out of the report.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isLoggedIn(text) {
  return /logged in as/i.test(text);
}

/**
 * @param {{id: string, label: string}[]} models
 * @returns {string}
 */
function formatModels(models) {
  return models
    .map((m) => (/\bdefault\b/i.test(m.label) ? `\`${m.id}\` (default)` : `\`${m.id}\``))
    .join(', ');
}

/**
 * Print just the model ids, one per line, for programmatic use.
 *
 * @returns {Promise<number>}
 */
async function printModels() {
  let bin;
  try {
    bin = await resolveBin();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n${INSTALL_HINT}\n`);
    return 1;
  }
  const res = await run(bin, ['models'], { timeoutMs: 30_000 });
  const models = parseModelList(res.stdout);
  if (res.exitCode !== 0 || models.length === 0) {
    process.stderr.write(`Could not read \`cursor-agent models\`: ${(res.stderr || res.stdout).trim() || 'no output'}\n`);
    return 1;
  }
  for (const m of models) process.stdout.write(`${m.id}\n`);
  return 0;
}

/**
 * @returns {Promise<number>}
 */
async function baseCheck() {
  const lines = ['### /cursor:setup\n'];
  let bin;
  try {
    bin = await resolveBin();
  } catch (err) {
    lines.push(`- ✗ ${err instanceof Error ? err.message : String(err)}`, '', INSTALL_HINT);
    process.stdout.write(lines.join('\n') + '\n');
    return 1;
  }
  lines.push(`- ✓ cursor-agent at \`${bin}\``);

  const ver = await run(bin, ['--version'], { timeoutMs: 10_000 });
  const versionText = `${ver.stdout}${ver.stderr}`.trim() || '(no output)';
  if (ver.exitCode !== 0) {
    lines.push(`- ✗ version: ${versionText}`);
    process.stdout.write(lines.join('\n') + '\n');
    return 1;
  }
  lines.push(`- ✓ version: ${versionText}`);

  const status = await run(bin, ['status'], { timeoutMs: 30_000 });
  const loggedIn = isLoggedIn(`${status.stdout}\n${status.stderr}`);
  lines.push(loggedIn ? '- ✓ signed in' : '- ✗ not signed in: run `cursor-agent login`');

  const about = await aboutInfo();
  if (about) {
    if (about.subscriptionTier) lines.push(`- plan: ${about.subscriptionTier}`);
    if (about.model) lines.push(`- account default model: ${about.model}`);
    if (about.latestStatus === 'update_available' && about.latestVersion) {
      lines.push(`- newer version available: ${about.latestVersion} (run \`/cursor:update\`)`);
    }
  }

  if (loggedIn) {
    const res = await run(bin, ['models'], { timeoutMs: 30_000 });
    const models = parseModelList(res.stdout);
    lines.push(models.length > 0 ? `- models: ${formatModels(models)}` : '- ✗ no models reported');
  }
  process.stdout.write(lines.join('\n') + '\n');
  return loggedIn ? 0 : 1;
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
