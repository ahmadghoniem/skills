#!/usr/bin/env node
// Stands in for grok in the tests; never touches the network. GROK_STUB_LOG
// receives the argv and the CLAUDECODE / GROK_CLAUDE_HOOKS_ENABLED it saw.
// GROK_STUB_MODE picks the answer: ok (default), error, crash, max_tokens.
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('grok 1.0.92 (b06756fd6256)\n');
  process.exit(0);
}
if (args[0] === 'models') {
  process.stdout.write('You are logged in with grok.com.\n\nDefault model: grok-4.7\n');
  process.exit(0);
}
if (process.env.GROK_STUB_LOG) {
  const brief = readFileSync(args[args.indexOf('--prompt-file') + 1], 'utf8');
  appendFileSync(
    process.env.GROK_STUB_LOG,
    `${JSON.stringify({ args, brief, CLAUDECODE: process.env.CLAUDECODE ?? null, hooks: process.env.GROK_CLAUDE_HOOKS_ENABLED ?? null })}\n`,
  );
}
const s = args.indexOf('-s') >= 0 ? args[args.indexOf('-s') + 1] : args[args.indexOf('--resume') + 1];
const mode = process.env.GROK_STUB_MODE ?? 'ok';
if (mode === 'crash') {
  process.stderr.write('warning: something noisy\nError: unexpected argument --bogus\n');
  process.exit(2);
}
if (mode === 'error') {
  process.stdout.write(
    JSON.stringify({ type: 'error', message: 'Internal error: API error (status 402 Payment Required): {"message":"Grok Build usage balance exhausted"}' }),
  );
  process.exit(1);
}
const stopReason = mode === 'max_tokens' ? 'max_tokens' : 'end_turn';
process.stdout.write(JSON.stringify({ text: 'Done: renamed X to Y.\n', stopReason, sessionId: s, num_turns: 3 }, null, 2));
