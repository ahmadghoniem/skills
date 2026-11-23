#!/usr/bin/env node
// Updates grok, then lists the releases since the version the plugin was last
// reviewed against, and the open papercuts to review against the new version.
// grok publishes no changelog: versions and dates come from the npm registry.
import { installedVersion, resolveBin } from './lib/grok.mjs';
import { papercutsPath, releasePath } from './lib/paths.mjs';
import { formatOpenPapercuts, readPapercuts } from './lib/shared/papercuts.mjs';
import { run, runAsScript } from './lib/shared/proc.mjs';
import {
  compareVersions,
  latestRelease,
  releasesSince,
  reviewedVersion,
  setReviewedVersion,
} from './lib/shared/release.mjs';

const REGISTRY_URL = 'https://registry.npmjs.org/@xai-official/grok';
const PACKAGE_JSON = new URL('../package.json', import.meta.url);

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

export const reviewedGrokVersion = () => reviewedVersion(PACKAGE_JSON, 'grok');

function papercutSection() {
  const open = formatOpenPapercuts(readPapercuts(papercutsPath()), 'grok');
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
    process.stderr.write('Could not read the current grok version.\n');
    return 1;
  }
  const update = await run(bin, ['update'], { timeoutMs: 15 * 60_000 });
  if (update.exitCode !== 0) {
    process.stderr.write(`grok update failed: ${(update.stderr || update.stdout || 'no output').trim()}\n`);
    return 1;
  }
  const after = await installedVersion();
  if (!after) {
    process.stderr.write('Update ran, but the new grok version could not be read.\n');
    return 1;
  }

  // Review every release since the last reviewed one, which is older than
  // `before` when grok was updated some other way.
  const reviewed = reviewedGrokVersion();
  const since = reviewed && compareVersions(reviewed, before) < 0 ? reviewed : before;
  if (compareVersions(after, since) === 0) {
    process.stdout.write(`grok is already up to date at ${before}.\n${papercutSection()}`);
    return 0;
  }
  setReviewedVersion(PACKAGE_JSON, 'grok', after);

  const release = await latestRelease(releasePath(), fetchLatest, { force: true });
  const between = release ? releasesSince(release.times, since, after) : [];
  const lines = [
    '### /grok:update\n',
    `- old version: ${before}`,
    ...(since !== before ? [`- last reviewed version: ${since}`] : []),
    `- new version: ${after}`,
    `- package.json \`engines.grok\` set to \`>=${after}\``,
    `- grok publishes no changelog; release dates are from ${REGISTRY_URL}`,
    '',
    between.length
      ? [`${between.length} release${between.length === 1 ? '' : 's'} since ${since}:`, ...between.map((r) => `  ${r.version}  ${r.date}`)].join('\n')
      : 'The npm registry could not be read, so the releases in between are not listed.',
  ];
  process.stdout.write(`${lines.join('\n')}\n${papercutSection()}`);
  return 0;
}

runAsScript(import.meta.url, main);
