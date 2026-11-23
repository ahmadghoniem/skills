// The installed grok must not be newer than the version the plugin was last
// reviewed against (`engines.grok` in package.json). `/grok:update` updates
// grok, lists the releases since that version, and sets it; a grok updated any
// other way fails here until `/grok:update` runs. Skipped where grok is not
// installed.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseVersion } from '../scripts/lib/grok.mjs';
import { versionOk } from '../scripts/setup.mjs';
import { compareVersions, reviewedGrokVersion } from '../scripts/update.mjs';

function installedGrok() {
  try {
    return parseVersion(execFileSync('grok', ['--version'], { encoding: 'utf8', timeout: 10_000 }));
  } catch {
    return null;
  }
}

const installed = installedGrok();

describe('grok version', () => {
  it('package.json names the reviewed grok version', () => {
    expect(reviewedGrokVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('setup refuses a grok older than the reviewed version', () => {
    expect(versionOk('grok 1.0.1 (abc)', '1.0.92')).toBe(false);
    expect(versionOk('grok 1.0.92 (abc)', '1.0.92')).toBe(true);
    expect(versionOk('(no output)', '1.0.92')).toBe(true);
  });

  it.skipIf(!installed)('the installed grok has been reviewed: run /grok:update if this fails', () => {
    expect(
      compareVersions(installed, reviewedGrokVersion()),
      `grok ${installed} installed, plugin reviewed against ${reviewedGrokVersion()}`,
    ).toBeLessThanOrEqual(0);
  });
});
