#!/usr/bin/env node
// Health check: where codex is and whether it is at least the reviewed
// version. `codex login status` shows the sign-in.
import { installedVersion, resolveBin } from './lib/codex.mjs';
import { run, runAsScript } from '../../../scripts/lib/shared/proc.mjs';
import { compareVersions } from '../../../scripts/lib/shared/release.mjs';
import { reviewedCodexVersion } from './update.mjs';

/** @returns {Promise<number>} */
export async function main() {
  const lines = ['### /mngr:setup codex\n'];
  const done = (code) => {
    process.stdout.write(`${lines.join('\n')}\n`);
    return code;
  };
  let bin;
  try {
    bin = await resolveBin();
  } catch (err) {
    lines.push(`- ✗ ${err.message}`);
    return done(1);
  }
  lines.push(`- ✓ codex at \`${bin}\``);
  const version = await installedVersion();
  const min = reviewedCodexVersion();
  if (!version) {
    lines.push('- ✗ `codex --version` did not answer');
    return done(1);
  }
  if (min && compareVersions(version, min) < 0) {
    lines.push(`- ✗ version ${version}; the plugin needs codex ${min} or newer. Run \`/mngr:update codex\`.`);
    return done(1);
  }
  lines.push(`- ✓ version ${version}`);
  const login = await run(bin, ['login', 'status'], { timeoutMs: 15_000 });
  const said = `${login.stdout}${login.stderr}`.trim().split(/\r?\n/)[0];
  if (login.exitCode !== 0) {
    lines.push(`- ✗ not signed in${said ? ` (${said})` : ''}: run \`codex login\``);
    return done(1);
  }
  lines.push(`- ✓ ${said || 'signed in'}`);
  return done(0);
}

runAsScript(import.meta.url, main);
