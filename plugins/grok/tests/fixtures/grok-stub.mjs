#!/usr/bin/env node
// Test stub for `grok`. Never talks to the network. Two modes:
//   - `models` / `--version`: canned CLI output (from a real install).
//   - otherwise: replay a fixture NDJSON stream chosen by GROK_STUB_FIXTURE.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);

if (process.env.GROK_STUB_FAIL === '1') {
  process.stderr.write('stub: forced failure\n');
  process.exit(1);
}

if (args[0] === 'models') {
  // Trimmed verbatim from a real `grok models` run, including the unhelpful
  // "You are not authenticated." preamble that a working install still prints.
  process.stdout.write(
    [
      'You are not authenticated.',
      '',
      'Available models:',
      '  * grok-4.6 (default)',
      '  - grok-4.5',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

if (args.includes('--version')) {
  process.stdout.write('1.0.5\n');
  process.exit(0);
}

// A run that never emits `end` and never exits, so the caller's watchdog is
// what ends it. Set only for the run itself — `models` and `--version` are
// answered above, so model resolution still works. This is the only way to
// reach the killed-run render path.
if (process.env.GROK_STUB_HANG === '1') {
  // The interval is what holds the process open. Without it Node drains the
  // loop with the await still pending and exits 13 ("never settled"), which
  // looks like a crash rather than a hang.
  setInterval(() => {}, 1_000);
  await new Promise(() => {});
}

const fixture = process.env.GROK_STUB_FIXTURE;
if (!fixture) {
  process.stderr.write('stub: GROK_STUB_FIXTURE not set\n');
  process.exit(2);
}

let content;
try {
  content = readFileSync(fixture, 'utf8');
} catch (err) {
  process.stderr.write(`stub: failed to read fixture ${fixture}: ${err.message}\n`);
  process.exit(2);
}

for (const line of content.split('\n').filter((l) => l.length > 0)) {
  process.stdout.write(line + '\n');
}
process.exit(0);
