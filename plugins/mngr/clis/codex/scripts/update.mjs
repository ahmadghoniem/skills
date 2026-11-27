#!/usr/bin/env node
// Updates codex, then lists the releases since the version the plugin was last
// reviewed against, with links to their notes, and the open papercuts.
import { installedVersion, resolveBin } from './lib/codex.mjs';
import { papercutsPath, releasePath } from './lib/paths.mjs';
import { formatOpenPapercuts, readPapercuts } from '../../../scripts/lib/shared/papercuts.mjs';
import { run, runAsScript } from '../../../scripts/lib/shared/proc.mjs';
import { compareVersions, latestRelease, releasesSince, reviewedVersion, setReviewedVersion } from '../../../scripts/lib/shared/release.mjs';

const RELEASES_API = 'https://api.github.com/repos/openai/codex/releases?per_page=100';
const RELEASE_NOTES = 'https://github.com/openai/codex/releases/tag/rust-v';
const PACKAGE_JSON = new URL('../../../package.json', import.meta.url);

export const reviewedCodexVersion = () => reviewedVersion(PACKAGE_JSON, 'codex');

/** `{latest, times}` from codex's stable GitHub releases (tags `rust-v<version>`), or null. */
export async function fetchLatest() {
  const res = await fetch(RELEASES_API, { signal: AbortSignal.timeout(5_000), headers: { accept: 'application/vnd.github+json' } });
  if (!res.ok) return null;
  const times = {};
  for (const r of await res.json()) {
    const v = /^rust-v(\d+\.\d+\.\d+)$/.exec(r?.tag_name ?? '')?.[1];
    if (v && !r.prerelease && !r.draft) times[v] = r.published_at;
  }
  const versions = Object.keys(times).sort(compareVersions);
  return versions.length ? { latest: versions.at(-1), times } : null;
}

function papercutSection() {
  const open = formatOpenPapercuts(readPapercuts(papercutsPath()), 'codex');
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
    process.stderr.write('Could not read the current codex version.\n');
    return 1;
  }
  const update = await run(bin, ['update'], { timeoutMs: 10 * 60_000 });
  if (update.exitCode !== 0) {
    process.stderr.write(`codex update failed: ${(update.stderr || update.stdout || 'no output').trim()}\n`);
    return 1;
  }
  const after = await installedVersion();
  if (!after) {
    process.stderr.write('The update ran, but the new codex version could not be read.\n');
    return 1;
  }
  const reviewed = reviewedCodexVersion();
  const since = reviewed && compareVersions(reviewed, before) < 0 ? reviewed : before;
  if (compareVersions(after, since) === 0) {
    process.stdout.write(`codex is already up to date at ${before}.\n${papercutSection()}`);
    return 0;
  }
  setReviewedVersion(PACKAGE_JSON, 'codex', after);
  const release = await latestRelease(releasePath(), fetchLatest, { force: true });
  const between = release ? releasesSince(release.times, since, after) : [];
  const lines = [
    '### /mngr:update codex\n',
    `- old version: ${before}`,
    ...(since !== before ? [`- last reviewed version: ${since}`] : []),
    `- new version: ${after}`,
    `- package.json \`engines.codex\` set to \`>=${after}\``,
    '',
    between.length
      ? [`${between.length} release${between.length === 1 ? '' : 's'} since ${since} (notes: ${RELEASE_NOTES}<version>):`, ...between.map((r) => `  ${r.version}  ${r.date}`)].join('\n')
      : 'GitHub could not be read, so the releases in between are not listed.',
  ];
  process.stdout.write(`${lines.join('\n')}\n${papercutSection()}`);
  return 0;
}

runAsScript(import.meta.url, main);
