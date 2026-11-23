#!/usr/bin/env node
// Test stub for `agy`. Never talks to the network. Two modes:
//   - `models` / `--version`: canned CLI output.
//   - otherwise: replay a fixture stream chosen by AGY_STUB_FIXTURE.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);

// Only a print run is recorded: `--version`, `models` and `plugin install` run
// alongside it and would overwrite the dump.
const printRun = args.includes('--output-format');
const argvDump = process.env.AGY_STUB_ARGV;
if (argvDump && printRun) {
  try {
    writeFileSync(argvDump, JSON.stringify(args), 'utf8');
  } catch {
    // noop
  }
}

if (process.env.AGY_STUB_ENV && printRun) {
  writeFileSync(
    process.env.AGY_STUB_ENV,
    JSON.stringify({ CLAUDECODE: process.env.CLAUDECODE ?? null, AGY_CLI_DISABLE_AUTO_UPDATE: process.env.AGY_CLI_DISABLE_AUTO_UPDATE ?? null }),
    'utf8',
  );
}

const stdinDump = process.env.AGY_STUB_STDIN;
if (stdinDump && args.includes('--input-format')) {
  try {
    writeFileSync(stdinDump, readFileSync(0, 'utf8'), 'utf8');
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

// `plugin install <dir>`: copy the plugin into ~/.gemini/config/plugins/<name>, as agy does.
if (args[0] === 'plugin' && args[1] === 'install') {
  const { cpSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const { name } = JSON.parse(readFileSync(join(args[2], 'plugin.json'), 'utf8'));
  const dest = join(homedir(), '.gemini', 'config', 'plugins', name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(args[2], dest, { recursive: true });
  process.stdout.write(`  [ok]    ${name}\n`);
  process.exit(0);
}

if (args.includes('--version')) {
  process.stdout.write('1.5.14\n');
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
if (process.env.AGY_STUB_STDERR) process.stderr.write(process.env.AGY_STUB_STDERR + '\n');
const code = process.env.AGY_STUB_EXIT ? Number(process.env.AGY_STUB_EXIT) : 0;
process.exit(Number.isFinite(code) ? code : 0);
