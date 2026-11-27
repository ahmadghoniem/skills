#!/usr/bin/env node
// Stands in for codex. CODEX_STUB_MODE: ok | error | crash. Logs each exec to CODEX_STUB_LOG.
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('codex-cli 0.172.0\n');
  process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
  process.stdout.write('Logged in using ChatGPT\n');
  process.exit(0);
}
const stdin = readFileSync(0, 'utf8');
if (process.env.CODEX_STUB_LOG) {
  appendFileSync(process.env.CODEX_STUB_LOG, `${JSON.stringify({ args, stdin, CLAUDECODE: process.env.CLAUDECODE ?? null })}\n`);
}
const emit = (ev) => process.stdout.write(`${JSON.stringify(ev)}\n`);
const mode = process.env.CODEX_STUB_MODE ?? 'ok';
if (mode === 'crash') {
  process.stderr.write('error: unexpected argument --bogus\n');
  process.exit(2);
}
const resumed = args[1] === 'resume' ? args[2] : null;
emit({ type: 'thread.started', thread_id: resumed ?? '01a2-thread-0001' });
emit({ type: 'turn.started' });
if (mode === 'error') {
  emit({ type: 'error', message: "You've hit your usage limit. Try again in 3 hours." });
  emit({ type: 'turn.failed', error: { message: "You've hit your usage limit. Try again in 3 hours." } });
  process.exit(1);
}
emit({ type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'Model metadata for `x` not found.' } });
emit({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'Done.' } });
emit({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } });
