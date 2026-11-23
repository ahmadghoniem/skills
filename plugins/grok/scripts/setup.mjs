#!/usr/bin/env node
// Health check: where grok is, whether it is at least the reviewed version, and
// whether it is signed in. For the model list, run `grok models` directly.
import { installedVersion, resolveBin } from './lib/grok.mjs';
import { run, runAsScript } from './lib/shared/proc.mjs';
import { compareVersions } from './lib/shared/release.mjs';
import { reviewedGrokVersion } from './update.mjs';

const INSTALL_HINT =
  'Install the Grok CLI so `grok` is on PATH (or at ~/.grok/bin), or set GROK_BIN to its full path. Then run `grok login`.';

/** @returns {Promise<number>} */
export async function main() {
  const lines = ['### /grok:setup\n'];
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
  lines.push(`- ✓ grok at \`${bin}\``);

  const version = await installedVersion();
  const min = reviewedGrokVersion();
  if (!version) {
    lines.push('- ✗ `grok --version` did not answer');
    return done(1);
  }
  if (min && compareVersions(version, min) < 0) {
    lines.push(`- ✗ version ${version}; the plugin needs grok ${min} or newer. Run \`/grok:update\`.`);
    return done(1);
  }
  lines.push(`- ✓ version ${version}`);

  // `grok models` is the only command that reports sign-in state.
  const models = await run(bin, ['models'], { timeoutMs: 10_000 });
  const text = `${models.stdout}\n${models.stderr}`;
  const signedIn = /you are logged in[^\n]*/i.exec(text)?.[0]?.replace(/\.$/, '');
  lines.push(signedIn ? `- ✓ ${signedIn}` : '- ✗ not signed in: run `grok login`');
  return done(signedIn ? 0 : 1);
}

runAsScript(import.meta.url, main);
