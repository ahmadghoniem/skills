// Version bookkeeping shared by the delegate plugins: the CLI version a plugin
// was last reviewed against, the latest release, and the once-per-release
// notice. See proc.mjs for how this file reaches each plugin.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The first dotted version in a string (`grok 1.0.92 (…)` → `1.0.92`), or null. */
export function parseVersion(text) {
  return /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(String(text ?? ''))?.[1] ?? null;
}

/** Compare dotted versions numerically: -1, 0 or 1. Missing parts count as 0. */
export function compareVersions(a, b) {
  const parts = (v) => String(v ?? '').split('.').map((p) => Number.parseInt(p, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Stable versions after `from`, up to and including `to`, oldest first, with
 * their dates from `times` (version → ISO time).
 *
 * @param {Record<string, string>} times
 * @param {string} from
 * @param {string} to
 */
export function releasesSince(times, from, to) {
  return Object.keys(times ?? {})
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .filter((v) => compareVersions(v, from) > 0 && compareVersions(v, to) <= 0)
    .sort(compareVersions)
    .map((version) => ({ version, date: String(times[version] ?? '').slice(0, 10) }));
}

/**
 * The CLI version a plugin was last reviewed against: `engines.<tool>` in its
 * package.json. Setup refuses an older CLI; update moves it forward.
 *
 * @param {string} packageJson
 * @param {string} tool
 */
export function reviewedVersion(packageJson, tool) {
  const range = JSON.parse(readFileSync(packageJson, 'utf8')).engines?.[tool] ?? '';
  return parseVersion(range);
}

/** @param {string} packageJson @param {string} tool @param {string} version */
export function setReviewedVersion(packageJson, tool, version) {
  const pkg = JSON.parse(readFileSync(packageJson, 'utf8'));
  pkg.engines = { ...pkg.engines, [tool]: `>=${version}` };
  writeFileSync(packageJson, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

function readState(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(path, state) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(state)}\n`, 'utf8');
  } catch {
    // A lost cache only costs another fetch.
  }
}

/**
 * The latest release, fetched at most once a day and cached in `path`.
 * `fetchLatest` returns `{latest, times?}` or null. Null when unknown; never
 * throws. `DELEGATE_RELEASE_CHECK=off` skips the network (the tests set it).
 *
 * @param {string} path
 * @param {() => Promise<{latest: string, times?: Record<string, string>}|null>} fetchLatest
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<{latest: string, times: Record<string, string>}|null>}
 */
export async function latestRelease(path, fetchLatest, opts = {}) {
  if (process.env.DELEGATE_RELEASE_CHECK === 'off') return null;
  const state = readState(path);
  const fresh = state.checkedAt && Date.now() - Date.parse(state.checkedAt) < DAY_MS;
  if (!fresh || opts.force) {
    let fetched = null;
    try {
      fetched = await fetchLatest();
    } catch {
      // Offline: keep the last answer and try again tomorrow.
    }
    if (fetched?.latest) {
      state.latest = fetched.latest;
      state.times = fetched.times ?? {};
    }
    state.checkedAt = new Date().toISOString();
    writeState(path, state);
  }
  return state.latest ? { latest: state.latest, times: state.times ?? {} } : null;
}

/**
 * One line saying a newer release is out, shown once per release: after it
 * prints, it stays quiet until a newer version appears. '' otherwise.
 *
 * @param {{path: string, tool: string, command: string, release: {latest: string, times: Record<string, string>}|null, installed: string|null}} o
 */
export function noticeOnce({ path, tool, command, release, installed }) {
  const latest = release?.latest;
  if (!latest || !installed || compareVersions(latest, installed) <= 0) return '';
  const state = readState(path);
  if (state.notified === latest) return '';
  writeState(path, { ...state, notified: latest });
  const count = releasesSince(release.times, installed, latest).length;
  const since = count > 1 ? `, ${count} releases after the installed ${installed}` : ` (installed: ${installed})`;
  return `\n${tool} ${latest} is out${since}. Ask the user whether to run \`${command}\`.\n`;
}
