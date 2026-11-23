// The installed opencode must not be newer than the version the plugin was last
// reviewed against (`engines.opencode`). `/opencode:update` sets it. Skipped where
// opencode is not installed.
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { compareVersions } from '../scripts/lib/shared/release.mjs';
import { reviewedOpencodeVersion } from '../scripts/update.mjs';

function installed() {
  try {
    return /\d+\.\d+\.\d+/.exec(execFileSync('opencode', ['--version'], { encoding: 'utf8', timeout: 15_000, shell: true }))?.[0] ?? null;
  } catch {
    return null;
  }
}
const version = installed();

it.skipIf(!version)('engines.opencode is the installed version or newer', () => {
  expect(compareVersions(version, reviewedOpencodeVersion())).toBeLessThanOrEqual(0);
});
