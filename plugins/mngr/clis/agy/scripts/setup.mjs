#!/usr/bin/env node
// Health check: where agy is, whether it is at least the reviewed version, and
// whether the agy plugin with the bash-delegate agent and its bash tool is
// installed. For the model list, run `agy models` directly.
import { PLUGIN_NAME, installPlugin, installedVersion, resolveBin } from './lib/agy.mjs';
import { runAsScript } from '../../../scripts/lib/shared/proc.mjs';
import { compareVersions } from '../../../scripts/lib/shared/release.mjs';
import { reviewedAgyVersion } from './update.mjs';

const INSTALL_HINT =
  'Install the Antigravity CLI so `agy` is on PATH (or at %LOCALAPPDATA%\\agy\\bin\\agy.exe), or set AGY_BIN to its full path.';

/** @returns {Promise<number>} */
export async function main() {
  const lines = ['### /mngr:setup agy\n'];
  const done = (code) => {
    process.stdout.write(`${lines.join('\n')}\n`);
    return code;
  };
  let bin;
  try {
    bin = await resolveBin();
  } catch (err) {
    lines.push(`- ✗ ${err.message}`, '', INSTALL_HINT);
    return done(1);
  }
  lines.push(`- ✓ agy at \`${bin}\``);
  const version = await installedVersion();
  const min = reviewedAgyVersion();
  if (!version) {
    lines.push('- ✗ `agy --version` did not answer');
    return done(1);
  }
  if (min && compareVersions(version, min) < 0) {
    lines.push(`- ✗ version ${version}; the plugin needs agy ${min} or newer. Run \`/mngr:update agy\`.`);
    return done(1);
  }
  lines.push(`- ✓ version ${version}`);
  try {
    const state = await installPlugin(bin);
    lines.push(`- ✓ agy plugin \`${PLUGIN_NAME}\` ${state}: the bash-delegate agent and its bash tool`);
  } catch (err) {
    lines.push(`- ✗ agy plugin: ${err.message}`);
    return done(1);
  }
  return done(0);
}

runAsScript(import.meta.url, main);
