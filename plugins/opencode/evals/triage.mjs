// Render a failed eval run down to the evidence a reader needs, and nothing else.
//
// The transcripts are stream-json: a five-session run is several megabytes, and
// reading them in an agent's own context is the most expensive part of an eval
// that otherwise costs nothing to interpret. Almost all of that weight is token
// deltas, system events and tool output nobody needs to see a grade explained.
//
// This prints, per failed check, the case, the grader's own detail line, the
// session's tool calls as one line each, and the final answer. That is enough
// to tell a real failure from a grading artifact, and it is small enough to
// hand to a cheap model instead of reading it yourself.
//
//   node evals/triage.mjs [runDir]      # newest caller run when omitted
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parseStream, cmdOf } from './lib/harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function newestRun() {
  const root = join(HERE, 'results', 'caller');
  const dirs = readdirSync(root).filter((d) => existsSync(join(root, d, 'results.jsonl')));
  if (!dirs.length) throw new Error(`no graded run under ${root}`);
  return join(root, dirs.sort().at(-1));
}

const dir = process.argv[2] ?? newestRun();
const rows = readFileSync(join(dir, 'results.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const errors = existsSync(join(dir, 'errors.jsonl'))
  ? readFileSync(join(dir, 'errors.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];

/** One line per tool call: enough to follow what the session did, no output. */
function timeline(streamPath) {
  if (!existsSync(streamPath)) return ['(transcript missing)'];
  const s = parseStream(readFileSync(streamPath, 'utf8'));
  return s.toolUses.map((t, i) => {
    const arg = cmdOf(t) || String(t.input?.file_path ?? t.input?.pattern ?? t.input?.description ?? '');
    const bg = t.input?.run_in_background ? ' [bg]' : '';
    const err = s.toolResults.get(t.id)?.is_error ? ' [ERROR]' : '';
    return `${String(i + 1).padStart(3)}. ${t.name}${bg}${err}  ${arg.replace(/\s+/g, ' ').slice(0, 140)}`;
  });
}

const out = [`# Triage — ${dir.split(/[\\/]/).at(-1)}`, ''];
const failed = rows.filter((r) => Object.values(r.grades).some(([pass]) => !pass));

out.push(
  `${rows.length} graded session(s), ${failed.length} with at least one failed check. ` +
    `${errors.length} session(s) never graded (see errors.jsonl).`,
  '',
);

if (errors.length) {
  out.push('## Ungraded', '');
  for (const e of errors) out.push(`- \`${e.case}\` rep ${e.rep}: ${e.reason}`);
  out.push('');
}

for (const r of failed) {
  const fails = Object.entries(r.grades).filter(([, [pass]]) => !pass);
  out.push(
    `## ${r.case} rep ${r.rep}`,
    '',
    `exit ${r.exit} · ${r.wallSeconds}s · ${r.toolCalls} tool calls · ${r.jobCount} job(s) · test ${r.testPasses ? 'passes' : 'FAILS'}`,
    '',
    'Failed checks:',
    '',
    ...fails.map(([k, [, detail]]) => `- **${k}** — ${detail}`),
    '',
    '<details><summary>Tool calls</summary>',
    '',
    '```',
    ...timeline(join(dir, `${r.case}-rep${r.rep}.stream.ndjson`)),
    '```',
    '',
    '</details>',
    '',
    'Final answer to the user:',
    '',
    '```',
    (r.finalText || '(none)').slice(0, 1500),
    '```',
    '',
  );
}

if (!failed.length) out.push('No failed checks.', '');

const path = join(dir, 'triage.md');
writeFileSync(path, out.join('\n'), 'utf8');
console.log(path);
