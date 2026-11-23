#!/usr/bin/env node
// Updates the opencode CLI and reports what changed: records the version
// before `opencode upgrade`, runs it, then fetches the GitHub release notes
// for every version in between so the orchestrator can check them against
// this plugin's assumptions.
//
// opencode has no `changelog` subcommand, so the notes come from the releases
// API. That is a network call that can fail, and a failed fetch never fails
// the upgrade: the version bump is the fact, the notes are the commentary.
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { refreshModelCache, resetBinCache, resolveBin } from './lib/opencode.mjs';
import { run } from './lib/run.mjs';

const RELEASES_URL = 'https://api.github.com/repos/sst/opencode/releases?per_page=100';

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
    .replace(/^v/i, '')
    .split('.')
    .map((p) => Number.parseInt(p, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

/**
 * Compare two dotted version strings numerically per component, so `1.18.31`
 * sorts above `1.18.9`. Returns -1, 0, or 1.
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
 * Which package manager owns this install, inferred from where the binary
 * sits. `opencode upgrade` picks its own method when this returns null, which
 * is right far more often than a wrong guess would be.
 *
 * @param {string} bin
 * @returns {'bun'|'npm'|'pnpm'|'brew'|'scoop'|'choco'|null}
 */
export function installMethod(bin) {
  const path = String(bin ?? '').replace(/\\/g, '/').toLowerCase();
  if (path.includes('/.bun/')) return 'bun';
  if (path.includes('/pnpm/')) return 'pnpm';
  if (path.includes('/npm/') || path.includes('/node_modules/')) return 'npm';
  if (path.includes('/homebrew/') || path.includes('/cellar/')) return 'brew';
  if (path.includes('/scoop/')) return 'scoop';
  if (path.includes('/chocolatey/')) return 'choco';
  return null;
}

/**
 * Release notes for every version above `from` and up to `to`, newest first.
 * Returns an empty list on any network or parse failure.
 *
 * @param {string} from
 * @param {string} to
 * @returns {Promise<{version: string, body: string}[]>}
 */
export async function releaseNotesBetween(from, to) {
  let releases;
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'opencode-delegate-plugin' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    releases = await res.json();
  } catch {
    return [];
  }
  if (!Array.isArray(releases)) return [];
  return releases
    .map((r) => ({
      version: String(r?.tag_name ?? '').replace(/^v/i, ''),
      body: String(r?.body ?? '').trim(),
    }))
    .filter((r) => r.version && compareVersions(r.version, from) > 0 && compareVersions(r.version, to) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * @param {string} bin
 * @returns {Promise<string>}
 */
async function readVersion(bin) {
  const res = await run(bin, ['--version'], { timeoutMs: 10_000 });
  return `${res.stdout}${res.stderr}`.trim().split(/\r?\n/).pop()?.trim() ?? '';
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { positional, flags } = parseCommandArgv(rawArgv, ['help']);
  if (flags['help']) {
    process.stdout.write('Usage: /opencode:update [target-version]\n');
    return 0;
  }

  const bin = await resolveBin();
  const before = await readVersion(bin);
  if (!before) {
    process.stderr.write(`Could not read the current version from ${bin}.\n`);
    return 1;
  }

  const method = installMethod(bin);
  const args = ['upgrade'];
  if (positional[0]) args.push(positional[0]);
  if (method) args.push('--method', method);

  const upgrade = await run(bin, args, { timeoutMs: 300_000 });

  // The binary may have been replaced in place, so drop the cached path and
  // ask again rather than trusting the one that was resolved before.
  resetBinCache();
  const afterBin = await resolveBin().catch(() => bin);
  const after = await readVersion(afterBin);

  const lines = [`before: ${before}`, `after:  ${after || 'could not be read'}`];
  if (method) lines.push(`method: ${method} (inferred from ${bin})`);

  if (!after) {
    lines.push('', 'The upgrade command said:');
    lines.push(...`${upgrade.stdout}${upgrade.stderr}`.trim().split(/\r?\n/).map((l) => `  ${l}`));
    process.stdout.write(`${lines.join('\n')}\n`);
    return 1;
  }

  if (compareVersions(after, before) === 0) {
    lines.push('', 'opencode is already up to date; nothing changed.');
    if (upgrade.exitCode !== 0) {
      lines.push('', `The upgrade command exited ${upgrade.exitCode}:`);
      lines.push(...`${upgrade.stdout}${upgrade.stderr}`.trim().split(/\r?\n/).map((l) => `  ${l}`));
    }
    process.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  }

  const notes = await releaseNotesBetween(before, after);
  if (notes.length === 0) {
    lines.push('', 'No release notes could be fetched for the versions in between.');
  } else {
    lines.push('', `release notes, ${before} → ${after}:`, '');
    for (const n of notes) {
      lines.push(`## ${n.version}`);
      lines.push(n.body || '(no notes)');
      lines.push('');
    }
  }

  // The model list can gain or lose entries across a version, and a stale
  // cache would then reject a model that now exists.
  await refreshModelCache().catch(() => {});

  process.stdout.write(`${lines.join('\n')}\n`);
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
