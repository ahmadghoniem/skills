#!/usr/bin/env node
// Test stub for `agy`. Never talks to the network. Two modes:
//   - `models` / `--version`: canned CLI output.
//   - otherwise: replay a fixture stream chosen by AGY_STUB_FIXTURE.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);

const argvDump = process.env.AGY_STUB_ARGV;
if (argvDump) {
  try {
    writeFileSync(argvDump, JSON.stringify(args), 'utf8');
  } catch {
    // noop
  }
}

if (process.env.AGY_STUB_FAIL === '1') {
  process.stderr.write('stub: forced failure\n');
  process.exit(1);
}

if (args[0] === 'models' || args.includes('models')) {
  process.stdout.write(
    [
      'gemini-3.7-flash-high\tGemini 3.7 Flash (High)',
      'gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)',
      'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)',
      'gemini-3.1-pro-high\tGemini 3.1 Pro (High)',
      'claude-sonnet-4-6\tClaude Sonnet 4.6',
      'claude-opus-4-6-thinking\tClaude Opus 4.6 Thinking',
      'gpt-oss-120b-medium\tGPT OSS 120B (Medium)',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

if (args.includes('--version')) {
  process.stdout.write('1.1.19\n');
  process.exit(0);
}

const fixture = process.env.AGY_STUB_FIXTURE;
if (!fixture) {
  process.stderr.write('stub: AGY_STUB_FIXTURE not set\n');
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
const code = process.env.AGY_STUB_EXIT ? Number(process.env.AGY_STUB_EXIT) : 0;
process.exit(Number.isFinite(code) ? code : 0);
