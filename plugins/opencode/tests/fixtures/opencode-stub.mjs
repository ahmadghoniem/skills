#!/usr/bin/env node
// Stands in for opencode. OPENCODE_STUB_MODE: ok | error | crash. Logs each call to OPENCODE_STUB_LOG.
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('2.4.1\n');
  process.exit(0);
}
const at = (flag) => args[args.indexOf(flag) + 1];
const session = at('--session');
if (process.env.OPENCODE_STUB_LOG) {
  appendFileSync(
    process.env.OPENCODE_STUB_LOG,
    `${JSON.stringify({ args, brief: readFileSync(at('-f'), 'utf8'), CLAUDECODE: process.env.CLAUDECODE ?? null, config: process.env.OPENCODE_CONFIG_CONTENT ?? null, compat: process.env.OPENCODE_DISABLE_CLAUDE_CODE ?? null })}\n`,
  );
}
const emit = (type, extra) => process.stdout.write(`${JSON.stringify({ type, timestamp: 1, sessionID: session, ...extra })}\n`);
const mode = process.env.OPENCODE_STUB_MODE ?? 'ok';
if (mode === 'crash') {
  process.stderr.write('boot\nError: Location plugins did not finish activating\n');
  process.exit(1);
}
if (mode === 'error') {
  emit('error', { error: { type: 'provider.quota', message: 'Free usage limit reached.' } });
  process.exit(1);
}
emit('step_start', { part: { type: 'step-start' } });
emit('tool_use', { part: { type: 'tool', tool: 'read', state: { status: 'error', error: 'File not found: a.txt' } } });
emit('tool_use', { part: { type: 'tool', tool: 'bash', state: { status: 'completed', output: 'exit 1' } } });
emit('text', { part: { type: 'text', text: 'Done.' } });
emit('step_finish', { part: { type: 'step-finish', reason: 'stop' } });
