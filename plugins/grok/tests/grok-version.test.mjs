// The installed grok must not be newer than the version the plugin was last
// reviewed against (`engines.grok`). `/grok:update` moves it forward; a grok
// updated another way fails here. Skipped where grok is not installed.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { compareVersions, parseVersion } from '../scripts/lib/shared/release.mjs';
import { reviewedGrokVersion } from '../scripts/update.mjs';

const installed = (() => {
  try {
    return parseVersion(execFileSync('grok', ['--version'], { encoding: 'utf8', timeout: 10_000 }));
  } catch {
    return null;
  }
})();

describe('grok version', () => {
  it('package.json names the reviewed version', () => {
    expect(reviewedGrokVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it.skipIf(!installed)('the installed grok has been reviewed: run /grok:update if this fails', () => {
    expect(compareVersions(installed, reviewedGrokVersion()), `grok ${installed} installed`).toBeLessThanOrEqual(0);
  });
});
