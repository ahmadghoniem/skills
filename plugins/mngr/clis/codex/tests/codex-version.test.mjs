// The installed codex must not be newer than the version the plugin was last
// reviewed against (`engines.codex`). `/mngr:update codex` sets it. Skipped where
// codex is not installed.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { compareVersions } from '../../../scripts/lib/shared/release.mjs';
import { reviewedCodexVersion } from '../scripts/update.mjs';

const BIN = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
const version = existsSync(BIN) ? /\d+\.\d+\.\d+/.exec(execFileSync(BIN, ['--version'], { encoding: 'utf8', timeout: 15_000 }))?.[0] ?? null : null;

it.skipIf(!version)('engines.codex is the installed version or newer', () => {
  expect(compareVersions(version, reviewedCodexVersion())).toBeLessThanOrEqual(0);
});
