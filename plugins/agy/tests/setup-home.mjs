// Every test file gets its own home directory, so a dispatch's installAgent and
// installBashServer write to it and not to the real ~/.gemini/config.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const home = mkdtempSync(join(tmpdir(), 'cad-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
afterAll(() => rmSync(home, { recursive: true, force: true }));
