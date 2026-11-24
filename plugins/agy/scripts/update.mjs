#!/usr/bin/env node
// Updates agy, then prints the changelog entries since the version the plugin
// was last reviewed against, and the open papercuts to review against them.
import { installedVersion, resolveBin } from './lib/agy.mjs';
import { shortenCut } from './lib/papercuts.mjs';
import { papercutsPath } from './lib/paths.mjs';
import { formatOpenPapercuts, readPapercuts } from './lib/shared/papercuts.mjs';
import { run, runAsScript } from './lib/shared/proc.mjs';
import { compareVersions, reviewedVersion, setReviewedVersion } from './lib/shared/release.mjs';

const RELEASES_URL = 'https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest';

/**
 * The upstream changelog, the fallback when `agy changelog` does not list the new
 * version yet (it has lagged: 1.2.11 printed nothing past 1.2.2).
 */
const UPSTREAM_CHANGELOG_URL = 'https://raw.githubusercontent.com/google-antigravity/antigravity-cli/main/CHANGELOG.md';

const PACKAGE_JSON = new URL('../package.json', import.meta.url);

export const reviewedAgyVersion = () => reviewedVersion(PACKAGE_JSON, 'agy');

/** `{latest}` from agy's latest GitHub release, or null. */
export async function fetchLatest() {
  const res = await fetch(RELEASES_URL, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) return null;
  const latest = String((await res.json()).tag_name ?? '').replace(/^v/, '');
  return latest ? { latest } : null;
}

/**
 * Parse a changelog (newest first) into version blocks. Accepts `agy changelog`
 * (`1.2.2:` headers) and the upstream CHANGELOG.md (`## 1.2.11` headers).
 *
 * @param {string} stdout
 * @returns {{version: string, text: string}[]}
 */
function parseChangelog(stdout) {
  const blocks = [];
  let current = null;
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const m = /^(?:#+\s*)?v?(\d+(?:\.\d+)+):?\s*$/.exec(line.trim());
    if (m) blocks.push((current = { version: m[1], lines: [line] }));
    else if (current) current.lines.push(line);
  }
  return blocks.map((b) => ({ version: b.version, text: b.lines.join('\n').replace(/\s+$/, '') }));
}

/** The changelog blocks strictly newer than `oldVersion`. */
export function newerChangelogEntries(changelog, oldVersion) {
  return parseChangelog(changelog).filter((b) => compareVersions(b.version, oldVersion) > 0);
}

/**
 * Entries newer than `since`: `agy changelog` first; the upstream file when the
 * local one does not list `newVersion` yet (or lists less).
 *
 * @param {{since: string, newVersion?: string, local: () => Promise<string|null>, upstream: () => Promise<string|null>}} o
 */
export async function changesSince({ since, newVersion, local, upstream }) {
  const lists = (entries) => (newVersion ? entries.some((e) => compareVersions(e.version, newVersion) >= 0) : entries.length > 0);
  const fromLocal = newerChangelogEntries((await local()) ?? '', since);
  if (lists(fromLocal)) return { entries: fromLocal, source: '`agy changelog`' };
  const fromUpstream = newerChangelogEntries((await upstream()) ?? '', since);
  if (lists(fromUpstream) || fromUpstream.length > fromLocal.length) return { entries: fromUpstream, source: UPSTREAM_CHANGELOG_URL };
  return { entries: fromLocal, source: '`agy changelog`' };
}

async function fetchUpstreamChangelog() {
  try {
    const res = await fetch(UPSTREAM_CHANGELOG_URL, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

function papercutSection() {
  const open = formatOpenPapercuts(readPapercuts(papercutsPath()), 'agy', shortenCut);
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
    process.stderr.write('Could not read the current agy version.\n');
    return 1;
  }
  // `agy update` downloads a ~200 MB binary.
  const update = await run(bin, ['update'], { timeoutMs: 15 * 60_000 });
  if (update.exitCode !== 0) {
    process.stderr.write(`agy update failed: ${(update.stderr || update.stdout || 'no output').trim()}\n`);
    return 1;
  }
  const after = await installedVersion();
  if (!after) {
    process.stderr.write('Update ran, but the new agy version could not be read.\n');
    return 1;
  }

  // Review every release since the last reviewed one, which is older than
  // `before` when agy was updated some other way.
  const reviewed = reviewedAgyVersion();
  const since = reviewed && compareVersions(reviewed, before) < 0 ? reviewed : before;
  if (compareVersions(after, since) === 0) {
    process.stdout.write(`agy is already up to date at ${before}.\n${papercutSection()}`);
    return 0;
  }
  setReviewedVersion(PACKAGE_JSON, 'agy', after);

  const { entries, source } = await changesSince({
    since,
    newVersion: after,
    local: async () => {
      const r = await run(bin, ['changelog'], { timeoutMs: 10_000 });
      return r.exitCode === 0 ? r.stdout : null;
    },
    upstream: fetchUpstreamChangelog,
  });
  const lines = [
    '### /agy:update\n',
    `- old version: ${before}`,
    ...(since !== before ? [`- last reviewed version: ${since}`] : []),
    `- new version: ${after}`,
    `- package.json \`engines.agy\` set to \`>=${after}\``,
    `- changelog: ${entries.length ? source : `neither \`agy changelog\` nor ${UPSTREAM_CHANGELOG_URL} lists an entry newer than ${since} yet`}`,
    '',
    entries.map((e) => e.text).join('\n\n'),
  ];
  process.stdout.write(`${lines.join('\n')}\n${papercutSection()}`);
  return 0;
}

runAsScript(import.meta.url, main);
