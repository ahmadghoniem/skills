#!/usr/bin/env node
// Health check: where opencode is and whether it is at least the reviewed
// version. `opencode models` lists the models; `opencode auth list` the providers.
import { installedVersion, resolveBin } from './lib/opencode.mjs';
import { runAsScript } from './lib/shared/proc.mjs';
import { compareVersions } from './lib/shared/release.mjs';
import { reviewedOpencodeVersion } from './update.mjs';

/** @returns {Promise<number>} */
export async function main() {
  const lines = ['### /opencode:setup\n'];
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
  lines.push(`- ✓ opencode at \`${bin}\``);
  const version = await installedVersion();
  const min = reviewedOpencodeVersion();
  if (!version) {
    lines.push('- ✗ `opencode --version` did not answer');
    return done(1);
  }
  if (min && compareVersions(version, min) < 0) {
    lines.push(`- ✗ version ${version}; the plugin needs opencode ${min} or newer. Run \`/opencode:update\`.`);
    return done(1);
  }
  lines.push(`- ✓ version ${version}`);
  return done(0);
}

runAsScript(import.meta.url, main);
