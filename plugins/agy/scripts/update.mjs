#!/usr/bin/env node
// Updates the agy CLI and reports what changed: records the version before
// `agy update`, runs it, then slices the changelog down to the entries newer
// than the recorded version so the orchestrator can check them against this
// plugin's workarounds, followed by the open papercuts to review against them.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { refreshModelCache, resolveBin } from './lib/agy.mjs';
import { formatOpenPapercuts } from './lib/papercuts.mjs';
import { pluginHome } from './lib/paths.mjs';
import { run } from './lib/run.mjs';

const RELEASES_URL =
  'https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest';

/** agy ships about four releases a week; checking once a day is enough. */
const RELEASE_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The upstream changelog. `agy changelog` lags it: 1.2.11 still printed
 * nothing past 1.2.2, so it is only the fallback.
 */
const UPSTREAM_CHANGELOG_URL =
  'https://raw.githubusercontent.com/google-antigravity/antigravity-cli/main/CHANGELOG.md';

/** `agy update` downloads a ~200 MB binary; 2m50s was measured on 1.2.2 -> 1.2.11. */
const UPDATE_TIMEOUT_MS = 15 * 60_000;

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
 * Compare two dotted version strings numerically per component, so `1.2.10`
 * sorts above `1.2.9`. Returns -1, 0, or 1.
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
 * @typedef {Object} ChangelogBlock
 * @property {string} version
 * @property {string} text     The `<version>:` header line plus its bullets, verbatim.
 */

/**
 * Parse a changelog (newest version first) into version blocks. Accepts both
 * shapes: `agy changelog` (`1.2.2:` headers) and the upstream CHANGELOG.md
 * (`## 1.2.11` headers).
 *
 * @param {string} stdout
 * @returns {ChangelogBlock[]}
 */
export function parseChangelog(stdout) {
  const text = String(stdout ?? '');
  const lines = text.split(/\r?\n/);
  /** @type {ChangelogBlock[]} */
  const blocks = [];
  let current = null;
  const headerRe = /^(?:#+\s*)?v?(\d+(?:\.\d+)+):?\s*$/;
  for (const line of lines) {
    const m = headerRe.exec(line.trim());
    if (m) {
      current = { version: m[1], lines: [line] };
      blocks.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return blocks.map((b) => ({
    version: b.version,
    text: b.lines.join('\n').replace(/\s+$/, ''),
  }));
}

/**
 * Keep only the changelog blocks strictly newer than `oldVersion`.
 *
 * @param {string} changelogStdout
 * @param {string} oldVersion
 * @returns {ChangelogBlock[]}
 */
export function newerChangelogEntries(changelogStdout, oldVersion) {
  const blocks = parseChangelog(changelogStdout);
  return blocks.filter((b) => compareVersions(b.version, oldVersion) > 0);
}

/**
 * The upstream CHANGELOG.md, or null when it cannot be fetched.
 *
 * @returns {Promise<string|null>}
 */
async function fetchUpstreamChangelog() {
  try {
    const res = await fetch(UPSTREAM_CHANGELOG_URL, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/**
 * Changelog entries newer than `oldVersion`: upstream first, then
 * `agy changelog`. `source` names where they came from.
 *
 * @param {string} bin
 * @param {string} oldVersion
 * @returns {Promise<{ entries: ChangelogBlock[], source: string }>}
 */
async function changesSince(bin, oldVersion) {
  const upstream = await fetchUpstreamChangelog();
  const fromUpstream = upstream ? newerChangelogEntries(upstream, oldVersion) : [];
  if (fromUpstream.length > 0) return { entries: fromUpstream, source: UPSTREAM_CHANGELOG_URL };
  const local = await run(bin, ['changelog'], { timeoutMs: 10_000 });
  const fromLocal = local.exitCode === 0 ? newerChangelogEntries(local.stdout, oldVersion) : [];
  return { entries: fromLocal, source: '`agy changelog`' };
}

/**
 * The latest agy release tag, fetched at most once a day and cached in
 * `~/.cad/agy-release.json`. Null when unknown. Never throws.
 * `CAD_RELEASE_CHECK=off` skips the network (the test suite sets it).
 *
 * @returns {Promise<string|null>}
 */
export async function latestRelease() {
  if (process.env.CAD_RELEASE_CHECK === 'off') return null;
  const path = join(pluginHome(), 'agy-release.json');
  let cached = null;
  try {
    cached = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // no cache yet
  }
  if (cached && Date.now() - Date.parse(cached.checkedAt) < RELEASE_CHECK_MAX_AGE_MS) {
    return cached.version ?? null;
  }
  let version = cached?.version ?? null;
  try {
    const res = await fetch(RELEASES_URL, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) version = String((await res.json()).tag_name ?? '').replace(/^v/, '') || version;
  } catch {
    // Offline: keep the last answer and try again tomorrow.
  }
  try {
    mkdirSync(pluginHome(), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ checkedAt: new Date().toISOString(), version })}\n`, 'utf8');
  } catch {
    // non-fatal
  }
  return version;
}

/**
 * One line telling the orchestrator a newer agy is out, or '' when not.
 *
 * @param {string|null} latest
 * @param {string|null} installed
 * @returns {string}
 */
export function updateNotice(latest, installed) {
  if (!latest || !installed || compareVersions(latest, installed) <= 0) return '';
  return `\nagy ${latest} is out (installed: ${installed}). Ask the user whether to run \`/agy:update\`.\n`;
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
    process.stderr.write(
      'Install the Antigravity CLI so `agy` is on PATH (or at %LOCALAPPDATA%\\agy\\bin\\agy.exe), or set AGY_BIN to its full path.\n',
    );
    return 1;
  }

  const before = await run(bin, ['--version'], { timeoutMs: 5_000 });
  if (before.exitCode !== 0) {
    process.stderr.write(
      `Could not read the current agy version: ${(before.stderr || before.stdout || 'no output').trim()}\n`,
    );
    return 1;
  }
  const oldVersion = `${before.stdout}${before.stderr}`.trim();
  if (!oldVersion) {
    process.stderr.write('agy --version printed no output.\n');
    return 1;
  }

  const update = await run(bin, ['update'], { timeoutMs: UPDATE_TIMEOUT_MS });
  if (update.exitCode !== 0) {
    process.stderr.write(
      `agy update failed: ${(update.stderr || update.stdout || 'no output').trim()}\n`,
    );
    return 1;
  }

  const after = await run(bin, ['--version'], { timeoutMs: 5_000 });
  if (after.exitCode !== 0) {
    process.stderr.write(
      `Update ran, but could not read the new agy version: ${(after.stderr || after.stdout || 'no output').trim()}\n`,
    );
    return 1;
  }
  const newVersion = `${after.stdout}${after.stderr}`.trim();
  if (!newVersion) {
    process.stderr.write('Update ran, but agy --version printed no output afterward.\n');
    return 1;
  }

  if (compareVersions(newVersion, oldVersion) === 0) {
    process.stdout.write(`agy is already up to date at ${oldVersion}.\n${papercutSection()}`);
    return 0;
  }

  // Stamps the new version in the model cache, which the update notice and
  // new papercuts read, and picks up any models the release added.
  await refreshModelCache().catch(() => {});

  const { entries, source } = await changesSince(bin, oldVersion);
  if (entries.length === 0) {
    // The update itself worked, so this is not a failure: neither changelog
    // lists the new version yet.
    process.stdout.write(
      `Updated ${oldVersion} -> ${newVersion}. Neither ${UPSTREAM_CHANGELOG_URL} nor \`agy changelog\` lists an entry newer than ${oldVersion}.\n${papercutSection()}`,
    );
    return 0;
  }

  const lines = [
    `### /agy:update\n`,
    `- old version: ${oldVersion}`,
    `- new version: ${newVersion}`,
    `- changelog: ${source}`,
    '',
  ];
  lines.push(entries.map((e) => e.text).join('\n\n'));
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
