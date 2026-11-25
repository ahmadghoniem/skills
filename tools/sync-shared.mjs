#!/usr/bin/env node
// Copies plugins/_shared/*.mjs into mngr's and council's scripts/lib/shared/.
// An installed plugin is copied on its own, so it cannot import a sibling
// folder; the copies are committed. `--check` changes nothing and exits 1 when
// a copy differs from its source (the root `npm test` runs it).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'plugins', '_shared');
const PLUGINS = ['mngr', 'council'];
const check = process.argv.includes('--check');

const files = readdirSync(source).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'));
const stale = [];
for (const plugin of PLUGINS) {
  if (!existsSync(join(root, 'plugins', plugin))) continue;
  const dest = join(root, 'plugins', plugin, 'scripts', 'lib', 'shared');
  for (const file of files) {
    const want = readFileSync(join(source, file), 'utf8');
    const target = join(dest, file);
    const have = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (have === want) continue;
    stale.push(`plugins/${plugin}/scripts/lib/shared/${file}`);
    if (!check) {
      mkdirSync(dest, { recursive: true });
      writeFileSync(target, want, 'utf8');
    }
  }
}

if (check && stale.length) {
  process.stderr.write(`Out of date with plugins/_shared (run node tools/sync-shared.mjs):\n  ${stale.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write(check ? 'shared copies are current\n' : `updated ${stale.length} file(s)\n`);
