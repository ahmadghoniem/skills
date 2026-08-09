#!/usr/bin/env node
import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCommandArgv } from './lib/args.mjs';
import {
  authStatus,
  fastVariant,
  isCursorModel,
  listConfiguredMcps,
  listModels,
  parseModelList,
  resolveBin,
} from './lib/cursor.mjs';
import { ensureDir, jobsDir, pluginHome } from './lib/paths.mjs';
import { run } from './lib/run.mjs';

function pluginRoot() {
  const envRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (envRoot && envRoot.trim()) return envRoot;
  // scripts/setup.mjs → ../ is the plugin root
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function checkScripts() {
  const scripts = join(pluginRoot(), 'scripts');
  const entry = join(scripts, 'setup.mjs');
  if (!existsSync(entry)) {
    return { ok: false, detail: `scripts/ missing or incomplete at ${scripts}` };
  }
  return { ok: true, detail: `scripts at ${scripts}` };
}

function checkJobsDir() {
  try {
    const home = pluginHome();
    ensureDir(home);
    const repoDir = jobsDir(process.cwd());
    ensureDir(repoDir);
    accessSync(repoDir, fsConstants.W_OK);
    return { ok: true, detail: repoDir };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

function maskKey(value) {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function doctor() {
  const lines = ['### /cursor:setup --doctor\n'];
  const checks = [];
  lines.push(`- Node: ${process.version}`);
  lines.push(`- Platform: ${process.platform} (${process.arch})`);
  lines.push(`- Plugin home: \`${pluginHome()}\``);

  let bin = '';
  try {
    bin = await resolveBin();
    checks.push(['cursor-agent binary', { ok: true, detail: bin }]);
  } catch (err) {
    checks.push([
      'cursor-agent binary',
      { ok: false, detail: err instanceof Error ? err.message : String(err) },
    ]);
  }
  if (bin) {
    const ver = await run(bin, ['--version'], { timeoutMs: 5_000 });
    checks.push([
      'cursor-agent version',
      { ok: ver.exitCode === 0, detail: (ver.stdout || ver.stderr).trim() },
    ]);
    const auth = await authStatus();
    checks.push([
      'cursor-agent auth',
      {
        ok: auth.loggedIn,
        detail: auth.loggedIn ? 'logged in' : 'not logged in — run `cursor-agent login`',
      },
    ]);
  }

  checks.push(['scripts', checkScripts()]);
  checks.push(['jobs directory writable', checkJobsDir()]);

  const apiKey = process.env.CURSOR_API_KEY;
  checks.push([
    'CURSOR_API_KEY',
    { ok: true, detail: apiKey ? `set (${maskKey(apiKey)})` : 'not set (using local session)' },
  ]);

  lines.push('');
  for (const [name, r] of checks) {
    const icon = r.ok ? '✓' : '✗';
    lines.push(`- ${icon} **${name}** — ${r.detail}`);
  }

  if (bin) {
    const mcps = await listConfiguredMcps();
    lines.push('');
    lines.push('**Configured Cursor MCPs:**');
    if (mcps.length === 0) {
      lines.push('- (none configured)');
    } else {
      for (const m of mcps) {
        const icon = m.loaded ? '✓' : '•';
        lines.push(`- ${icon} \`${m.name}\` — ${m.status}`);
      }
    }
  }

  // The CURSOR_API_KEY check is already `ok:true` whether or not the key is
  // set, so a literal `r.ok` is correct here — a stray "not set" substring in
  // some other check's stderr must not mask a real failure.
  const allOk = checks.every(([, r]) => r.ok);
  lines.push('');
  lines.push(allOk ? 'All checks passed.' : 'Some checks failed — see above.');
  process.stdout.write(lines.join('\n') + '\n');
  return allOk ? 0 : 1;
}

/**
 * Print the account's live model list split into the two usage pools the
 * Cursor dashboard itself shows: "Cursor Models" (included in the plan) and
 * "Other Models" (metered per token). `-fast` ids are folded into their base
 * entry rather than listed separately — the lineup is ~190 ids and roughly
 * half of them are speed variants.
 *
 * @returns {Promise<number>}
 */
async function printModels() {
  const lines = await listModels();
  const ids = parseModelList(lines);
  if (ids.length === 0) {
    process.stdout.write('### Cursor models (from your account)\n\n');
    process.stdout.write(
      'Could not fetch model list. Try `cursor-agent --list-models` directly or `cursor-agent models`.\n',
    );
    return 1;
  }

  // `auto` is a server-side router, not a model — it belongs to neither pool,
  // and listing it under "metered" would misstate what it costs.
  const base = ids.filter((id) => !id.endsWith('-fast') && id !== 'auto');
  const render = (id) => {
    const fast = fastVariant(id, ids);
    return fast ? `- \`${id}\` (fast variant: \`${fast}\`)\n` : `- \`${id}\`\n`;
  };

  process.stdout.write('### Cursor models (from your account)\n\n');
  process.stdout.write('**Included in your plan** — drawn from the "Cursor Models" pool:\n\n');
  for (const id of base.filter(isCursorModel)) process.stdout.write(render(id));
  process.stdout.write('\n**Metered per token** — drawn from the "Other Models" pool:\n\n');
  for (const id of base.filter((id) => !isCursorModel(id))) process.stdout.write(render(id));
  process.stdout.write(
    '\nA `-fast` variant runs the same model on faster hardware at roughly 2x the usage cost.\n',
  );
  if (ids.includes('auto')) {
    process.stdout.write(
      '`auto` lets Cursor pick on the server — which pool it draws from depends on what it picks.\n',
    );
  }
  return 0;
}

async function maybeInstall() {
  process.stdout.write(
    'This will run: `curl https://cursor.com/install -fsS | bash`\n' +
      'Aborting automatic execution — re-run the command above manually to install.\n',
  );
  return 0;
}

async function baseCheck() {
  const lines = ['### /cursor:setup\n'];
  try {
    const bin = await resolveBin();
    lines.push(`- ✓ \`cursor-agent\` at \`${bin}\``);
    const auth = await authStatus();
    lines.push(
      auth.loggedIn
        ? '- ✓ Cursor CLI is logged in.'
        : '- ✗ Cursor CLI is not logged in. Run `cursor-agent login` in a terminal.',
    );
    const scripts = checkScripts();
    lines.push(scripts.ok ? `- ✓ ${scripts.detail}` : `- ✗ ${scripts.detail}`);
    const jobs = checkJobsDir();
    lines.push(jobs.ok ? `- ✓ jobs dir writable: \`${jobs.detail}\`` : `- ✗ ${jobs.detail}`);
    lines.push('');
    lines.push('Ready. Try `/cursor:delegate "write a short haiku about git"` to smoke-test.');
    process.stdout.write(lines.join('\n') + '\n');
    return 0;
  } catch (err) {
    lines.push(`- ✗ ${err instanceof Error ? err.message : String(err)}`);
    lines.push('');
    lines.push(
      'Install Cursor CLI with: `curl https://cursor.com/install -fsS | bash`\n' +
        'Then run `cursor-agent login` and re-run `/cursor:setup`.',
    );
    process.stdout.write(lines.join('\n') + '\n');
    return 1;
  }
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { flags } = parseCommandArgv(rawArgv, ['doctor', 'print-models', 'install']);
  if (flags['doctor']) return doctor();
  if (flags['print-models'] || flags['printModels']) return printModels();
  if (flags['install']) return maybeInstall();
  return baseCheck();
}

import { invokedAsScript as __isScript } from './lib/invoked.mjs';
const invokedAsScript = __isScript(import.meta.url);

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`setup failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
