#!/usr/bin/env node
// Stands in for a member plugin's delegate.mjs. The model decides what it does:
// `slow` sleeps past any test timeout, `noblock` answers without a final block,
// `edit` writes a file. It always logs what it was sent to STUB_LOG.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { 'prompt-file': { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' }, session: { type: 'string' }, conversation: { type: 'string' } },
});
const member = process.env.STUB_MEMBER ?? 'grok';
const brief = readFileSync(values['prompt-file'], 'utf8');
appendFileSync(process.env.STUB_LOG, `${JSON.stringify({ member, ...values, brief })}\n`);
const model = values.model ?? 'm';
if (model === 'slow') setTimeout(() => {}, 60_000);
else {
  if (model === 'edit') writeFileSync('touched.txt', 'x');
  const id = values.session ?? values.conversation ?? `${member}-${model}`;
  const block = model === 'noblock' ? '' : `=== FINAL ANSWER ===\nPosition: ${model} says yes\n=== END ===\n`;
  process.stdout.write(`I looked.\n${block}\n${member === 'agy' ? 'conversation' : 'session'}: ${id}\n`);
}
