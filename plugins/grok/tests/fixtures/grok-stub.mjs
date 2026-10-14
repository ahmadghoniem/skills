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
  process.stdout.write(
    [
      'You are logged in with grok.com.',
      '',
      'Default model: grok-4.7',
      '',
      'Available models:',
      '  * grok-4.7 (default)',
      '  - grok-4.6',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

if (args.includes('--version')) {
  process.stdout.write('grok 1.0.52 (0920c8169e27) [stable]\n');
  process.exit(0);
}

// A run that never emits `end` and never exits, so the caller's watchdog is
// what ends it. Set only for the run itself — `models` and `--version` are
// answered above. This is the only way to reach the killed-run render path.
if (process.env.GROK_STUB_HANG === '1') {
  // One opening event first, as a real run sends, so the session counts as
  // started and the killed run is offered a resume.
  process.stdout.write('{"type":"text","data":"Starting."}\n');
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

// grok reports the session it was given (`-s` for a new one, `--resume` for an
// existing one) in its `end` event, so the stub does the same.
const flag = args.findIndex((a) => a === '-s' || a === '--resume');
const session = flag === -1 ? undefined : args[flag + 1];
for (const line of content.split('\n').filter((l) => l.length > 0)) {
  const out = session ? line.replace(/"sessionId":"[^"]*"/, `"sessionId":"${session}"`) : line;
  process.stdout.write(out + '\n');
}
process.exit(0);
