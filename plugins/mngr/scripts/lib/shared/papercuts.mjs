// The friction log shared by every CLI mngr drives: one JSON object per line,
// append-only, machine-wide per CLI (`~/.mngr/<cli>`). Each
// plugin decides which of its warnings become rows; this file stores, groups
// and closes them.
//
// Every cut has a `key`, its group: a warning id, `tool-errors:<tool>`, or
// `narrated`. A resolution names a key, closing every cut in that group
// recorded before it, or one cut's id. Nothing is ever rewritten, so a fix
// that did not hold shows up as its key coming back.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { parseCli } from './proc.mjs';

/**
 * A message on one line, at most 500 characters. A longer one keeps its start
 * and its end, where a command's output usually says why it failed.
 *
 * @param {unknown} s
 */
export function oneLine(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= 500 ? t : `${t.slice(0, 160)} … ${t.slice(-337)}`;
}

/** Append one cut. Never throws; returns its id, or null if the write failed. */
export function appendPapercut(path, cut) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const id = createHash('sha256').update(JSON.stringify(cut)).digest('hex').slice(0, 8);
    appendFileSync(path, `${JSON.stringify({ id, ...cut })}\n`, 'utf8');
    return id;
  } catch {
    return null;
  }
}

/** Every row; malformed lines are skipped. */
export function readPapercuts(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object') out.push(row);
    } catch {
      // a line cut short by a crash
    }
  }
  return out;
}

/** Whether a resolution closes a cut: it names the cut's id, or its key and came after it. */
export function closes(fix, cut) {
  return fix.resolves === cut.id || (fix.resolves === cut.key && String(fix.ts) > String(cut.ts));
}

/**
 * The open cuts, one block per key, largest first, then the keys that came back
 * after a recorded fix. '' when nothing is open.
 *
 * @param {Record<string, unknown>[]} all
 * @param {string} tool  the CLI name, for the version column
 * @param {(text: string) => string} [shorten]  drops boilerplate a CLI wraps its messages in
 */
export function formatOpenPapercuts(all, tool, shorten = (t) => t) {
  const fixes = all.filter((c) => c.resolves);
  const open = all.filter((c) => !c.resolves && !fixes.some((f) => closes(f, c)));
  if (open.length === 0) return '';

  const groups = new Map();
  for (const c of open) {
    const k = String(c.key ?? 'unkeyed');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const out = [`${plural(open.length, 'open papercut')} in ${plural(ordered.length, 'cluster')}:`, ''];
  for (const [key, cuts] of ordered) {
    cuts.sort((a, b) => (String(a.ts) < String(b.ts) ? 1 : -1));
    const versions = [...new Set(cuts.map((c) => String(c.toolVersion ?? '')).filter(Boolean))];
    const span = `${String(cuts.at(-1).ts).slice(0, 10)} to ${String(cuts[0].ts).slice(0, 10)}`;
    out.push(`## ${key} — ${cuts.length}×, ${span}${versions.length ? `, ${tool} ${versions.join(' ')}` : ''}`);
    const byText = new Map();
    for (const c of cuts) {
      const t = shorten(String(c.text ?? '').trim());
      if (!byText.has(t)) byText.set(t, []);
      byText.get(t).push(c);
    }
    const texts = [...byText.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [text, same] of texts.slice(0, 3)) {
      out.push(`  ${same.length}×  \`${same[0].id}\`  ${String(same[0].ts).slice(0, 10)}  ${text.slice(0, 300)}`);
      if (same[0].fix) out.push(`      fix: ${String(same[0].fix).trim()}`);
    }
    if (texts.length > 3) out.push(`  … and ${texts.length - 3} more distinct messages`);
    out.push('');
  }
  const back = [];
  for (const [key, cuts] of ordered) {
    const fix = fixes.filter((f) => f.resolves === key).sort((a, b) => (String(a.ts) < String(b.ts) ? -1 : 1)).at(-1);
    if (fix) back.push(`  ${key}: ${cuts.length} new since the ${String(fix.ts).slice(0, 10)} fix (${String(fix.text ?? '').trim()})`);
  }
  if (back.length) out.push('Recurred after a recorded fix — the fix did not hold:', ...back, '');
  return out.join('\n');
}

const PAPERCUT_USAGE = (cmd) => `Usage: ${cmd} --text "<what went wrong>" [--fix "<what would have prevented it>"]
            [--quote "<the delegate's own words>"] [--session <id>] [--model <id>]
       ${cmd} --resolve <key|id> --note "<what was changed>"
`;

/**
 * The `/x:papercut` command: record what a delegate said got in its way
 * (`narrated`), or close cuts once a fix lands.
 *
 * @param {string[]} argv
 * @param {{path: string, command: string, pluginVersion: string, toolVersion: () => Promise<string|undefined>}} ctx
 * @returns {Promise<number>}
 */
export async function papercutMain(argv, ctx) {
  let values;
  try {
    ({ values } = parseCli(argv, {
      text: { type: 'string' },
      fix: { type: 'string' },
      quote: { type: 'string' },
      session: { type: 'string' },
      model: { type: 'string' },
      resolve: { type: 'string' },
      note: { type: 'string' },
      help: { type: 'boolean' },
    }));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n${PAPERCUT_USAGE(ctx.command)}`);
    return 2;
  }
  if (values.help) {
    process.stdout.write(PAPERCUT_USAGE(ctx.command));
    return 0;
  }
  const now = new Date().toISOString();

  if (values.resolve?.trim()) {
    const target = values.resolve.trim();
    const cuts = readPapercuts(ctx.path).filter((c) => !c.resolves);
    const byKey = cuts.some((c) => c.key === target);
    if (!byKey && !cuts.some((c) => c.id === target)) {
      process.stderr.write(`Error: no papercut key or id \`${target}\` in ${ctx.path}.\n`);
      return 2;
    }
    if (!values.note?.trim()) {
      process.stderr.write('Error: --resolve needs --note saying what was changed.\n');
      return 2;
    }
    const id = appendPapercut(ctx.path, {
      ts: now,
      source: 'resolution',
      pluginVersion: ctx.pluginVersion,
      text: values.note.trim(),
      resolves: target,
    });
    process.stdout.write(`resolved ${byKey ? 'key' : 'cut'} \`${target}\` (recorded as \`${id}\`).\n`);
    return 0;
  }

  if (!values.text?.trim()) {
    process.stderr.write(`Error: --text is required.\n${PAPERCUT_USAGE(ctx.command)}`);
    return 2;
  }
  const id = appendPapercut(ctx.path, {
    ts: now,
    source: 'narrated',
    key: 'narrated',
    text: values.text.trim(),
    toolVersion: await ctx.toolVersion(),
    pluginVersion: ctx.pluginVersion,
    model: values.model?.trim() || undefined,
    repo: process.cwd(),
    sessionId: values.session?.trim() || undefined,
    fix: values.fix?.trim() || undefined,
    evidence: values.quote?.trim() ? { quote: values.quote.trim() } : undefined,
  });
  if (!id) {
    process.stderr.write('Error: could not write to the papercut log.\n');
    return 1;
  }
  process.stdout.write(`papercut \`${id}\` recorded.\n`);
  return 0;
}
