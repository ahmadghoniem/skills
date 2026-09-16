#!/usr/bin/env node
// Updates the agy CLI and reports what changed: records the version before
// `agy update`, runs it, then slices `agy changelog` down to the entries
// newer than the recorded version so the orchestrator can check them against
// this plugin's workarounds.
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { resolveBin } from './lib/agy.mjs';
import { run } from './lib/run.mjs';

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
 * Parse `agy changelog` output (newest version first) into version blocks.
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
  const headerRe = /^(\d+(?:\.\d+)*):\s*$/;
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

  const update = await run(bin, ['update'], { timeoutMs: 120_000 });
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
    process.stdout.write(`agy is already up to date at ${oldVersion}.\n`);
    return 0;
  }

  const changelog = await run(bin, ['changelog'], { timeoutMs: 10_000 });
  if (changelog.exitCode !== 0) {
    process.stderr.write(
      `Updated ${oldVersion} -> ${newVersion}, but agy changelog failed: ${(changelog.stderr || changelog.stdout || 'no output').trim()}\n`,
    );
    return 1;
  }

  const entries = newerChangelogEntries(changelog.stdout, oldVersion);
  if (entries.length === 0) {
    // The update itself worked, so this is not a failure: agy changed its
    // changelog format, or shipped a version it does not list.
    process.stdout.write(
      `Updated ${oldVersion} -> ${newVersion}. agy changelog lists no entry newer than ${oldVersion}; run \`agy changelog\` yourself to see what changed.\n`,
    );
    return 0;
  }

  const lines = [`### /agy:update\n`, `- old version: ${oldVersion}`, `- new version: ${newVersion}`, ''];
  lines.push(entries.map((e) => e.text).join('\n\n'));
  process.stdout.write(lines.join('\n') + '\n');
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
