#!/usr/bin/env node
// Stand-in for the agy binary during evals. Replays one fixture chosen by
// AGY_REPLAY: stdout events, stderr lines, then the recorded exit code.
//
// Extra controls, all optional:
//   AGY_REPLAY_HANG=1          after replaying, never exit (for watchdog and orphan cases)
//   AGY_REPLAY_DELAY_MS=<n>    wait before exiting
//   AGY_REPLAY_WRITES=a,b      create these files in the working directory first
//   AGY_REPLAY_ARGV=<path>     dump the argv the plugin passed
//   AGY_REPLAY_FILES=<json>    {"path": "content"} written into the working directory
//   AGY_REPLAY_RESPONSE=<text> replaces the fixture's redacted write-up
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (process.env.AGY_REPLAY_ARGV) writeFileSync(process.env.AGY_REPLAY_ARGV, JSON.stringify(args), 'utf8');
if (args[0] === 'models') {
  process.stdout.write('gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\nclaude-opus-4-6-thinking\tClaude Opus 4.6 Thinking\n');
  process.exit(0);
}
if (args.includes('--version')) {
  process.stdout.write('1.2.2\n');
  process.exit(0);
}

const fixture = JSON.parse(readFileSync(process.env.AGY_REPLAY, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const f of (process.env.AGY_REPLAY_WRITES ?? '').split(',').filter(Boolean)) {
  writeFileSync(join(process.cwd(), f), `written by ${process.pid}\n`, 'utf8');
}

if (process.env.AGY_REPLAY_FILES) {
  for (const [f, body] of Object.entries(JSON.parse(process.env.AGY_REPLAY_FILES))) writeFileSync(join(process.cwd(), f), body, 'utf8');
}
if (process.env.AGY_REPLAY_RESPONSE != null) {
  for (const ev of fixture.events) if (ev.event === 'result' && ev.result?.response) ev.result.response = process.env.AGY_REPLAY_RESPONSE;
}

const hang = process.env.AGY_REPLAY_HANG === '1';
const events = hang ? fixture.events.filter((e) => e.event !== 'result') : fixture.events;
for (const ev of events) process.stdout.write(JSON.stringify(ev) + '\n');
for (const line of fixture.stderr ?? []) process.stderr.write(line + '\n');

if (hang) {
  setInterval(() => {}, 1 << 30);
} else {
  await sleep(Number(process.env.AGY_REPLAY_DELAY_MS ?? 0));
  process.exit(typeof fixture.exitCode === 'number' ? fixture.exitCode : 0);
}
