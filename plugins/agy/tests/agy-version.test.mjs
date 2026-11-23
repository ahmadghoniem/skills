// The installed agy must not be newer than the version the plugin was last
// reviewed against (`engines.agy` in package.json). `/agy:update` updates agy,
// prints the changelog since that version, and sets it; an agy updated any other
// way fails here until `/agy:update` runs. Skipped where agy is not installed.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { compareVersions } from '../scripts/lib/shared/release.mjs';
import { reviewedAgyVersion } from '../scripts/update.mjs';

function installedAgy() {
  try {
    return /\d+\.\d+\.\d+/.exec(execFileSync('agy', ['--version'], { encoding: 'utf8', timeout: 10_000 }))?.[0] ?? null;
  } catch {
    return null;
  }
}

const installed = installedAgy();

describe('agy version', () => {
  it('package.json names the reviewed agy version', () => {
    expect(reviewedAgyVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.skipIf(!installed)('the installed agy has been reviewed: run /agy:update if this fails', () => {
    expect(compareVersions(installed, reviewedAgyVersion()), `agy ${installed} installed, plugin reviewed against ${reviewedAgyVersion()}`).toBeLessThanOrEqual(0);
  });
});
