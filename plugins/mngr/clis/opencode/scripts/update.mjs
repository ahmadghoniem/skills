#!/usr/bin/env node
// Upgrades opencode, then lists the releases since the version the plugin was
// last reviewed against, with links to their notes, and the open papercuts.
import { installedVersion, resolveBin } from './lib/opencode.mjs';
import { papercutsPath, releasePath } from './lib/paths.mjs';
import { formatOpenPapercuts, readPapercuts } from '../../../scripts/lib/shared/papercuts.mjs';
import { run, runAsScript } from '../../../scripts/lib/shared/proc.mjs';
import { compareVersions, latestRelease, releasesSince, reviewedVersion, setReviewedVersion } from '../../../scripts/lib/shared/release.mjs';

/** The opencode 2.x CLI ships as `@opencode/cli`; `opencode-ai` is the 1.x line. */
const REGISTRY_URL = 'https://registry.npmjs.org/@opencode%2fcli';
const RELEASE_NOTES = 'https://github.com/anomalyco/opencode/releases/tag/v';
const PACKAGE_JSON = new URL('../../../package.json', import.meta.url);

export const reviewedOpencodeVersion = () => reviewedVersion(PACKAGE_JSON, 'opencode');

/** `{latest, times}` from the npm registry, or null. */
export async function fetchLatest() {
  const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) return null;
  const doc = await res.json();
  const latest = doc?.['dist-tags']?.latest;
  if (typeof latest !== 'string') return null;
  const times = {};
  for (const [v, t] of Object.entries(doc.time ?? {})) if (/^\d+\.\d+\.\d+$/.test(v)) times[v] = t;
  return { latest, times };
}

function papercutSection() {
  const open = formatOpenPapercuts(readPapercuts(papercutsPath()), 'opencode');
  return open ? `\n### Open papercuts\n\n${open}` : '';
}

/** @returns {Promise<number>} */
export async function main() {
  let bin;
  try {
    bin = await resolveBin();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
  const before = await installedVersion();
  if (!before) {
    process.stderr.write('Could not read the current opencode version.\n');
    return 1;
  }
  const upgrade = await run(bin, ['upgrade'], { timeoutMs: 10 * 60_000 });
  if (upgrade.exitCode !== 0) {
    process.stderr.write(`opencode upgrade failed: ${(upgrade.stderr || upgrade.stdout || 'no output').trim()}\n`);
    return 1;
  }
  const after = await installedVersion();
  if (!after) {
    process.stderr.write('Upgrade ran, but the new opencode version could not be read.\n');
    return 1;
  }
  const reviewed = reviewedOpencodeVersion();
  const since = reviewed && compareVersions(reviewed, before) < 0 ? reviewed : before;
  if (compareVersions(after, since) === 0) {
    process.stdout.write(`opencode is already up to date at ${before}.\n${papercutSection()}`);
    return 0;
  }
  setReviewedVersion(PACKAGE_JSON, 'opencode', after);
  const release = await latestRelease(releasePath(), fetchLatest, { force: true });
  const between = release ? releasesSince(release.times, since, after) : [];
  const lines = [
    '### /mngr:update opencode\n',
    `- old version: ${before}`,
    ...(since !== before ? [`- last reviewed version: ${since}`] : []),
    `- new version: ${after}`,
    `- package.json \`engines.opencode\` set to \`>=${after}\``,
    '',
    between.length
      ? [`${between.length} release${between.length === 1 ? '' : 's'} since ${since} (notes: ${RELEASE_NOTES}<version>):`, ...between.map((r) => `  ${r.version}  ${r.date}`)].join('\n')
      : 'The npm registry could not be read, so the releases in between are not listed.',
  ];
  process.stdout.write(`${lines.join('\n')}\n${papercutSection()}`);
  return 0;
}

runAsScript(import.meta.url, main);
