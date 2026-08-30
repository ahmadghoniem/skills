#!/usr/bin/env node
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { parseModelList, resolveBin } from './lib/grok.mjs';
import { run } from './lib/run.mjs';

const INSTALL_HINT =
  'Install the Grok CLI so `grok` is on PATH (or at ~/.grok/bin), or set GROK_BIN to its full path.\n' +
  'Then run `grok login` and re-run `/grok:setup`.';

/**
 * `grok models` prints "You are logged in with grok.com." when authenticated,
 * and says the account is not authenticated otherwise. That is the health
 * check — `grok doctor` only covers terminal/clipboard/mic.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isLoggedIn(text) {
  return /you are logged in/i.test(text);
}

/**
 * @param {string} text
 * @returns {string}
 */
function loginDetail(text) {
  const m = /you are logged in[^\n]*/i.exec(text);
  if (m?.[0]) return m[0].trim().replace(/\.$/, '');
  if (/not authenticated/i.test(text)) return 'not authenticated — run `grok login`';
  return 'authentication state unknown — run `grok login`';
}

/**
 * @param {string[]} ids
 * @param {string} text
 * @returns {string}
 */
function formatModels(ids, text) {
  const defaultMatch = /^\s*Default model:\s+(\S+)/m.exec(text);
  const defaultId = defaultMatch?.[1];
  return ids
    .map((id) => (id === defaultId ? `\`${id}\` (default)` : `\`${id}\``))
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
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write(INSTALL_HINT + '\n');
    return 1;
  }
  const res = await run(bin, ['models'], { timeoutMs: 10_000 });
  const text = `${res.stdout}\n${res.stderr}`;
  if (!isLoggedIn(text)) {
    process.stderr.write(`${loginDetail(text)}.\n`);
    return 1;
  }
  const ids = parseModelList(text);
  if (ids.length === 0) {
    process.stderr.write('Could not parse model list from `grok models`.\n');
    return 1;
  }
  for (const id of ids) process.stdout.write(`${id}\n`);
  return 0;
}

/**
 * @returns {Promise<number>}
 */
async function baseCheck() {
  const lines = ['### /grok:setup\n'];
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
  lines.push(`- ✓ grok at \`${bin}\``);

  const ver = await run(bin, ['--version'], { timeoutMs: 5_000 });
  const versionText = `${ver.stdout}${ver.stderr}`.trim() || '(no output)';
  if (ver.exitCode !== 0) {
    lines.push(`- ✗ version: ${versionText}`);
    process.stdout.write(lines.join('\n') + '\n');
    return 1;
  }
  lines.push(`- ✓ version: ${versionText}`);

  const models = await run(bin, ['models'], { timeoutMs: 10_000 });
  const text = `${models.stdout}\n${models.stderr}`;
  const loggedIn = isLoggedIn(text);
  lines.push(loggedIn ? `- ✓ ${loginDetail(text)}` : `- ✗ ${loginDetail(text)}`);
  const ids = parseModelList(text);
  if (ids.length > 0) {
    lines.push(`- models: ${formatModels(ids, text)}`);
  } else {
    lines.push('- ✗ no models reported');
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
