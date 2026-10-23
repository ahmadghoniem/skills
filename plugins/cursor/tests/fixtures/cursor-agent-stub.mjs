#!/usr/bin/env node
// Test stub for `cursor-agent`. Never talks to the network. Two modes:
//   - `--version`, `about`, `status`, `models`, `update`: canned CLI output
//     (shapes copied from 2026.10.22-27dcf5f).
//   - otherwise: replay a fixture NDJSON stream chosen by CURSOR_AGENT_STUB_FIXTURE.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const VERSION = process.env.CURSOR_AGENT_STUB_VERSION || '2026.10.22-27dcf5f';

if (process.env.CURSOR_AGENT_STUB_ARGV_OUT) {
  writeFileSync(process.env.CURSOR_AGENT_STUB_ARGV_OUT, JSON.stringify(args), 'utf8');
}

if (process.env.CURSOR_AGENT_STUB_FAIL === '1') {
  process.stderr.write('stub: forced failure\n');
  process.exit(1);
}

if (args[0] === '--version' || args[0] === '-v') {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

if (args[0] === 'about') {
  const latest = process.env.CURSOR_AGENT_STUB_LATEST;
  process.stdout.write(
    `${JSON.stringify(
      {
        cliVersion: VERSION,
        latestStatus: latest && latest !== VERSION ? 'update_available' : 'up_to_date',
        latestVersion: latest || VERSION,
        model: 'Auto',
        subscriptionTier: 'Free',
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

if (args[0] === 'status') {
  process.stdout.write('\n ✓ Logged in as test@example.com\n\n');
  process.exit(0);
}

if (args[0] === 'models') {
  process.stdout.write(
    [
      'Available models',
      '',
      'auto - Auto (current, default)',
      'composer-2.5 - Composer 2.5',
      'gpt-5.3-codex - Codex 5.3',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

if (args[0] === 'update') {
  process.stdout.write('Already up to date\n');
  process.exit(0);
}

const sessionFlag = args.findIndex((a) => a === '--new-session-id' || a === '--resume');
const session = sessionFlag === -1 ? 'stub-session' : args[sessionFlag + 1];

// A run that never sends `result` and never exits, so the caller's watchdog
// is what ends it.
if (process.env.CURSOR_AGENT_STUB_HANG === '1') {
  process.stdout.write(
    `{"type":"system","subtype":"init","session_id":"${session}","model":"Auto"}\n` +
      `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Starting."}]},"session_id":"${session}"}\n`,
  );
  setInterval(() => {}, 1_000);
  await new Promise(() => {});
}

const fixture = process.env.CURSOR_AGENT_STUB_FIXTURE;
if (!fixture) {
  process.stderr.write('stub: CURSOR_AGENT_STUB_FIXTURE not set\n');
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
  process.stdout.write(`${line.replace(/"session_id":"[^"]*"/g, `"session_id":"${session}"`)}\n`);
}
if (process.env.CURSOR_AGENT_STUB_STDERR) {
  process.stderr.write(`${process.env.CURSOR_AGENT_STUB_STDERR}\n`);
}

// cursor-agent has been seen to send `result` and then not exit.
if (process.env.CURSOR_AGENT_STUB_POST_RESULT_HANG === '1') {
  setInterval(() => {}, 1_000);
  await new Promise(() => {});
}
process.exit(Number(process.env.CURSOR_AGENT_STUB_EXIT ?? 0));
