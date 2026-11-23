#!/usr/bin/env node
// apply-patch for agy, best-effort: the blocks that match are written, and the error lists
// the ones that did not, so a retry sends only those. agy's bash tool runs this as
// `apply-patch`; Claude Code runs tools/apply-patch, which stays all-or-nothing, and
// cannot reach this file. Same patch format and parser (./apply-patch.mjs, a copy of
// tools/apply-patch). Exit 0 when every block applied, 1 when any failed, so a check
// chained with && runs only on a whole patch; 2 when the patch could not be read.
import { readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { commit, parsePatch, PatchError, planPatch } from './apply-patch.mjs';

/** The failed ops and blocks as patch text, so a kept --file patch holds only what is left. */
export function failedPatch(failed) {
  const out = [];
  const seen = new Map();
  for (const { op, block } of failed) {
    if (op.kind === 'delete') { out.push(`*** Delete: ${op.path}`); continue; }
    if (op.kind === 'create' || op.kind === 'append') {
      out.push(`*** ${op.kind === 'create' ? 'Create' : 'Append'}: ${op.path}`, op.content.replace(/\n$/, ''));
      continue;
    }
    if (!seen.has(op)) { seen.set(op, true); out.push(`*** Update: ${op.path}`); }
    for (const b of block ? [block] : op.blocks) {
      out.push(`<<<<<<< SEARCH${b.all ? ' all' : ''}`, b.search, '=======', b.replace, '>>>>>>> REPLACE');
    }
  }
  return out.join('\n') + '\n';
}

const listed = (problems) => (problems.length === 1 ? problems[0] : problems.map((m, k) => `${k + 1}. ${m}`).join('\n'));

function main(argv) {
  const args = argv.slice(2);
  const dry = args.includes('--dry-run');
  const keep = args.includes('--keep');
  const fi = args.indexOf('--file');
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('usage: apply-patch [--file <patch> [--keep]] [--dry-run]   (patch on stdin when --file is absent; blocks that match are written, failed ones are listed)\n');
    return 0;
  }
  let text;
  try {
    text = fi >= 0 ? readFileSync(args[fi + 1], 'utf8') : readFileSync(0, 'utf8');
  } catch (e) {
    process.stderr.write(`apply-patch: cannot read patch: ${e.message}\n`);
    return 2;
  }
  let plan;
  try {
    plan = planPatch(parsePatch(text), process.cwd(), { partial: true });
  } catch (e) {
    if (!(e instanceof PatchError)) throw e;
    process.stderr.write(`apply-patch: ${e.message}\nNo files were changed.\n`);
    return 1;
  }
  const { files, report, problems, failed } = plan;
  if (!problems.length) {
    if (!dry) commit(plan);
    let removed = '';
    if (!dry && !keep && fi >= 0) {
      try { unlinkSync(args[fi + 1]); removed = `; removed ${args[fi + 1].replaceAll('\\', '/')}`; } catch { /* already gone or locked */ }
    }
    process.stdout.write(report.join('\n') + `\n${dry ? 'dry run: nothing written' : `ok: ${files.size} file(s)${removed}`}\n`);
    return 0;
  }
  if (!files.size) {
    const head = problems.length === 1 ? '' : `${problems.length} problems. Fix all of them and send the patch again.\n`;
    process.stderr.write(`apply-patch: ${head}${listed(problems)}\nNo files were changed.\n`);
    return 1;
  }
  if (!dry) commit(plan);
  let kept = '';
  if (!dry && fi >= 0) {
    try { writeFileSync(args[fi + 1], failedPatch(failed), 'utf8'); kept = ` ${args[fi + 1].replaceAll('\\', '/')} now holds only the failed blocks; fix them there and run it again.`; } catch { /* leave it */ }
  }
  process.stdout.write(report.join('\n') + `\n${dry ? 'dry run: nothing written; ' : ''}partial: ${files.size} file(s) written, ${problems.length} problem(s) not applied\n`);
  process.stderr.write(`apply-patch: not applied, the rest of the patch was written:\n${listed(problems)}\nSend only these again, written against the files as they are now.${kept}\n`);
  return 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv);
