#!/usr/bin/env node
// Updates the Cursor CLI and reports what changed: records the version before
// `cursor-agent update`, runs it, then prints the old and new versions,
// followed by the open papercuts to review against the new version.
//
// The only machine-readable release source is `cursor-agent about --format
// json`, which reports `latestVersion` and whether it is newer. It has no
// release list and no dates beyond the one in the version string itself, so
// the notice says only that a newer version is available.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { aboutInfo, parseVersion, resolveBin } from './lib/cursor.mjs';
import { formatOpenPapercuts } from './lib/papercuts.mjs';
import { pluginHome } from './lib/paths.mjs';
import { run } from './lib/run.mjs';

const CHANGELOG_URL = 'https://cursor.com/docs/cli/changelog';

/** Checking once a day is enough. */
const RELEASE_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** `cursor-agent update` downloads the whole runtime. */
const UPDATE_TIMEOUT_MS = 15 * 60_000;

/**
 * Compare two date-stamped versions (`2026.10.22-27dcf5f`) by their date.
 * Returns -1, 0 or 1. Two builds of the same day compare equal.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareVersions(a, b) {
  const parts = (v) =>
    String(v ?? '')
      .split('-')[0]
      .split('.')
      .map((p) => Number.parseInt(p, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The newest Cursor CLI version, when `cursor-agent about` says it is newer
 * than the installed one. Asked at most once a day and cached in
 * `~/.ccd/cursor-release.json`. Null when unknown or up to date. Never
 * throws. `CCD_RELEASE_CHECK=off` skips the check (the test suite sets it).
 *
 * @param {{force?: boolean}} [opts]  `force` skips the cache
 * @returns {Promise<{latest: string}|null>}
 */
export async function latestRelease(opts = {}) {
  if (process.env.CCD_RELEASE_CHECK === 'off') return null;
  const path = join(pluginHome(), 'cursor-release.json');
  let cached = null;
  try {
    cached = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // no cache yet
  }
  const fresh = cached && Date.now() - Date.parse(cached.checkedAt) < RELEASE_CHECK_MAX_AGE_MS;
  if (fresh && !opts.force) return cached.latest ? { latest: cached.latest } : null;

  const about = await aboutInfo();
  // Offline: keep the last answer and try again tomorrow.
  const latest = about
    ? about.latestStatus === 'update_available'
      ? about.latestVersion
      : null
    : (cached?.latest ?? null);
  try {
    mkdirSync(pluginHome(), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ checkedAt: new Date().toISOString(), latest })}\n`, 'utf8');
  } catch {
    // non-fatal
  }
  return latest ? { latest } : null;
}

/**
 * One line telling the orchestrator a newer Cursor CLI is available, or ''.
 *
 * @param {{latest: string}|null} release
 * @param {string|null} installed
 * @returns {string}
 */
export function updateNotice(release, installed) {
  const latest = release?.latest;
  if (!latest || !installed || latest === installed) return '';
  if (compareVersions(latest, installed) < 0) return '';
  return `\nA newer Cursor CLI version is available: ${latest} (installed: ${installed}). Ask the user whether to run \`/cursor:update\`.\n`;
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
  const res = await run(bin, ['--version'], { timeoutMs: 10_000 });
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
    process.stderr.write(`Could not read the current cursor-agent version: ${before.error}\n`);
    return 1;
  }

  const update = await run(bin, ['update'], { timeoutMs: UPDATE_TIMEOUT_MS });
  if (update.exitCode !== 0) {
    process.stderr.write(
      `cursor-agent update failed: ${(update.stderr || update.stdout || 'no output').trim()}\n`,
    );
    return 1;
  }

  const after = await installedVersion(bin);
  if (!after.version) {
    process.stderr.write(`Update ran, but could not read the new cursor-agent version: ${after.error}\n`);
    return 1;
  }

  // Refresh the cached answer so the notice stops once the update landed.
  await latestRelease({ force: true }).catch(() => null);

  if (after.version === before.version) {
    process.stdout.write(`cursor-agent is already up to date at ${before.version}.\n${papercutSection()}`);
    return 0;
  }

  const lines = [
    '### /cursor:update\n',
    `- old version: ${before.version}`,
    `- new version: ${after.version}`,
    `- Cursor's changelog is date-headed, without version numbers: ${CHANGELOG_URL}`,
  ];
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
