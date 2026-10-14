#!/usr/bin/env node
// Updates the grok CLI and reports what changed: records the version before
// `grok update`, runs it, then lists the releases in between with their dates,
// followed by the open papercuts to review against the new version.
//
// grok publishes no changelog. The npm registry entry for `@xai-official/grok`
// is the one public record of its releases, so the version list and dates come
// from there.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { parseVersion, resolveBin } from './lib/grok.mjs';
import { formatOpenPapercuts } from './lib/papercuts.mjs';
import { pluginHome } from './lib/paths.mjs';
import { run } from './lib/run.mjs';

const REGISTRY_URL = 'https://registry.npmjs.org/@xai-official/grok';

/** grok ships several builds a week; checking once a day is enough. */
const RELEASE_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** `grok update` downloads the whole binary. */
const UPDATE_TIMEOUT_MS = 15 * 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} Release
 * @property {string} latest                 the `latest` dist-tag, i.e. stable
 * @property {Record<string, string>} times  version -> ISO publish time
 */

/**
 * Parse a dotted version string into numeric components. Non-numeric or
 * missing components compare as 0, so `1.2` and `1.2.0` are equal.
 *
 * @param {string} version
 * @returns {number[]}
 */
function versionParts(version) {
  return String(version ?? '')
    .trim()
    .split('.')
    .map((p) => Number.parseInt(p, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

/**
 * Compare two dotted version strings numerically per component, so `1.0.10`
 * sorts above `1.0.9`. Returns -1, 0, or 1.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareVersions(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/**
 * The versions after `installed`, up to and including `latest`, oldest first.
 *
 * Versions with a `-` suffix (`0.1.220-alpha.4`) are prereleases and are
 * skipped. The plain numbered versions between two stable releases are builds
 * from grok's alpha channel that never got the `latest` tag; they are counted,
 * because the stable release that follows contains them.
 *
 * @param {Record<string, string>} times
 * @param {string} installed
 * @param {string} latest
 * @returns {{version: string, date: string}[]}
 */
export function releasesSince(times, installed, latest) {
  return Object.keys(times ?? {})
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .filter((v) => compareVersions(v, installed) > 0 && compareVersions(v, latest) <= 0)
    .sort(compareVersions)
    .map((version) => ({ version, date: String(times[version] ?? '').slice(0, 10) }));
}

/**
 * Fetch the registry document. Null when it cannot be fetched.
 *
 * @returns {Promise<Release|null>}
 */
async function fetchRelease() {
  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const doc = await res.json();
    const latest = doc?.['dist-tags']?.latest;
    if (typeof latest !== 'string') return null;
    /** @type {Record<string, string>} */
    const times = {};
    for (const [v, t] of Object.entries(doc.time ?? {})) {
      if (/^\d+\.\d+\.\d+$/.test(v) && typeof t === 'string') times[v] = t;
    }
    return { latest, times };
  } catch {
    return null;
  }
}

/**
 * The latest stable grok release and the publish dates of every release,
 * fetched at most once a day and cached in `~/.cgd/grok-release.json`. Null
 * when unknown. Never throws. `CGD_RELEASE_CHECK=off` skips the network (the
 * test suite sets it).
 *
 * @param {{force?: boolean}} [opts]  `force` skips the cache
 * @returns {Promise<Release|null>}
 */
export async function latestRelease(opts = {}) {
  if (process.env.CGD_RELEASE_CHECK === 'off') return null;
  const path = join(pluginHome(), 'grok-release.json');
  let cached = null;
  try {
    cached = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // no cache yet
  }
  const fresh = cached && Date.now() - Date.parse(cached.checkedAt) < RELEASE_CHECK_MAX_AGE_MS;
  if (fresh && !opts.force) {
    return cached.latest ? { latest: cached.latest, times: cached.times ?? {} } : null;
  }
  // Offline: keep the last answer and try again tomorrow.
  const release =
    (await fetchRelease()) ??
    (cached?.latest ? { latest: cached.latest, times: cached.times ?? {} } : null);
  try {
    mkdirSync(pluginHome(), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({ checkedAt: new Date().toISOString(), latest: release?.latest ?? null, times: release?.times ?? {} })}\n`,
      'utf8',
    );
  } catch {
    // non-fatal
  }
  return release;
}

/**
 * @param {number} n
 * @param {string} word
 */
function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * One line telling the orchestrator a newer grok is out, or '' when not.
 *
 * @param {Release|null} release
 * @param {string|null} installed
 * @param {number} [now]
 * @returns {string}
 */
export function updateNotice(release, installed, now = Date.now()) {
  const latest = release?.latest;
  if (!latest || !installed || compareVersions(latest, installed) <= 0) return '';
  const published = Date.parse(release.times?.[latest] ?? '');
  const days = Math.max(0, Math.floor((now - published) / DAY_MS));
  const age = Number.isFinite(published)
    ? ` (released ${days === 0 ? 'today' : `${plural(days, 'day')} ago`})`
    : '';
  const count = releasesSince(release.times, installed, latest).length;
  const since = count > 0 ? `; ${plural(count, 'release')} since the installed ${installed}` : `; installed: ${installed}`;
  return `\ngrok ${latest} is out${age}${since}. Ask the user whether to run \`/grok:update\`.\n`;
}

/**
 * The open papercuts, headed for the review, or '' when none are open.
 *
 * @returns {string}
 */
function papercutSection() {
  const open = formatOpenPapercuts();
  return open ? `\n### Open papercuts\n\n${open}` : '';
}

/**
 * @param {string} bin
 * @returns {Promise<{version: string|null, error: string}>}
 */
async function installedVersion(bin) {
  const res = await run(bin, ['--version'], { timeoutMs: 5_000 });
  const text = `${res.stdout}${res.stderr}`.trim();
  if (res.exitCode !== 0) return { version: null, error: text || 'no output' };
  const version = parseVersion(text);
  return { version, error: version ? '' : `no version in \`${text || '(no output)'}\`` };
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  parseCommandArgv(rawArgv, []);

  let bin;
  try {
    bin = await resolveBin();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const before = await installedVersion(bin);
  if (!before.version) {
    process.stderr.write(`Could not read the current grok version: ${before.error}\n`);
    return 1;
  }

  const update = await run(bin, ['update'], { timeoutMs: UPDATE_TIMEOUT_MS });
  if (update.exitCode !== 0) {
    process.stderr.write(
      `grok update failed: ${(update.stderr || update.stdout || 'no output').trim()}\n`,
    );
    return 1;
  }

  const after = await installedVersion(bin);
  if (!after.version) {
    process.stderr.write(`Update ran, but could not read the new grok version: ${after.error}\n`);
    return 1;
  }

  if (compareVersions(after.version, before.version) === 0) {
    process.stdout.write(`grok is already up to date at ${before.version}.\n${papercutSection()}`);
    return 0;
  }

  const release = await latestRelease({ force: true });
  const between = release ? releasesSince(release.times, before.version, after.version) : [];

  const lines = [
    `### /grok:update\n`,
    `- old version: ${before.version}`,
    `- new version: ${after.version}`,
    `- grok publishes no changelog; release dates are from ${REGISTRY_URL}`,
    '',
  ];
  if (between.length > 0) {
    lines.push(`${plural(between.length, 'release')} since ${before.version}:`);
    for (const r of between) lines.push(`  ${r.version}  ${r.date}`);
  } else {
    lines.push('The npm registry could not be read, so the releases in between are not listed.');
  }
  process.stdout.write(lines.join('\n') + '\n' + papercutSection());
  return 0;
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`update failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
