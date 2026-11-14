#!/usr/bin/env node
// Batch file edits for agents: SEARCH/REPLACE blocks across several files, checked
// in memory first and written only if every block applies. See README.md.
import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADER = /^\*\*\* (Update|Create|Delete|Append): (.+?)\s*$/;
const SEARCH = /^<<<<<<< SEARCH( all)?\s*$/;
const DIVIDER = /^=======\s*$/;
const REPLACE = /^>>>>>>> REPLACE\s*$/;

export class PatchError extends Error {}

const marker = (line) => (HEADER.test(line) ? `header "${line.slice(0, 60)}"` : '"<<<<<<< SEARCH"');

export function parsePatch(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const ops = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const h = HEADER.exec(line);
    if (!h) {
      if (line.trim() === '') { i++; continue; }
      throw new PatchError(`line ${i + 1}: expected a "*** Update|Create|Delete|Append: <path>" header, got: ${line.slice(0, 80)}`);
    }
    const op = { kind: h[1].toLowerCase(), path: h[2].replace(/\\/g, '/'), line: i + 1 };
    i++;
    if (op.kind === 'delete') { ops.push(op); continue; }
    if (op.kind === 'create' || op.kind === 'append') {
      const body = [];
      while (i < lines.length && !HEADER.test(lines[i])) body.push(lines[i++]);
      while (body.length && body.at(-1).trim() === '') body.pop();
      op.content = body.length ? body.join('\n') + '\n' : '';
      ops.push(op);
      continue;
    }
    op.blocks = [];
    while (i < lines.length && !HEADER.test(lines[i])) {
      if (lines[i].trim() === '') { i++; continue; }
      const s = SEARCH.exec(lines[i]);
      if (!s) throw new PatchError(`line ${i + 1}: expected "<<<<<<< SEARCH" in ${op.path}, got: ${lines[i].slice(0, 80)}`);
      const start = i + 1;
      const search = [], replace = [];
      i++;
      while (i < lines.length && !DIVIDER.test(lines[i])) {
        if (REPLACE.test(lines[i])) throw new PatchError(`line ${i + 1}: ">>>>>>> REPLACE" comes before the "=======" divider of the block at line ${start}`);
        if (HEADER.test(lines[i])) throw new PatchError(`line ${i + 1}: ${marker(lines[i])} inside the block at line ${start}, which has no "=======" divider yet`);
        search.push(lines[i++]);
      }
      if (i >= lines.length) throw new PatchError(`line ${start}: SEARCH block has no "=======" divider before the patch ends`);
      i++;
      while (i < lines.length && !REPLACE.test(lines[i])) {
        if (DIVIDER.test(lines[i])) throw new PatchError(`line ${i + 1}: second "=======" in the block at line ${start}; end the REPLACE text with ">>>>>>> REPLACE". A line that is exactly "=======" cannot be patch text; use the Edit tool for it`);
        if (HEADER.test(lines[i]) || SEARCH.test(lines[i])) throw new PatchError(`line ${i + 1}: ${marker(lines[i])} before the block at line ${start} has its ">>>>>>> REPLACE" end marker`);
        replace.push(lines[i++]);
      }
      if (i >= lines.length) throw new PatchError(`line ${start}: block has no ">>>>>>> REPLACE" end marker before the patch ends`);
      i++;
      op.blocks.push({ line: start, all: !!s[1], search: search.join('\n'), replace: replace.join('\n') });
    }
    if (!op.blocks.length) throw new PatchError(`line ${op.line}: "*** Update: ${op.path}" has no SEARCH/REPLACE blocks`);
    ops.push(op);
  }
  if (!ops.length) throw new PatchError('patch is empty');
  return ops;
}

// Line endings: a file whose every newline is CRLF is edited as LF and written back
// as CRLF. Anything else is edited as-is, and patch text (LF) is inserted as LF.
function decode(raw) {
  const bom = raw.startsWith('﻿');
  let text = bom ? raw.slice(1) : raw;
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length;
  const eol = crlf > 0 && crlf === lf ? '\r\n' : '\n';
  if (eol === '\r\n') text = text.replace(/\r\n/g, '\n');
  return { text, bom, eol };
}
const encode = ({ text, bom, eol }) => (bom ? '﻿' : '') + (eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text);

function countExact(text, needle) {
  const hits = [];
  for (let from = 0; ; ) { const k = text.indexOf(needle, from); if (k < 0) break; hits.push(k); from = k + needle.length; }
  return { n: hits.length, at: hits.length ? hits[0] : -1, lines: hits.map((k) => lineOf(text, k)) };
}

// Fallbacks when the exact text is not found: compare line by line, first ignoring
// trailing whitespace (also stray \r), then ignoring indentation too.
const STRATEGIES = [['trailing-whitespace', (s) => s.trimEnd()], ['indentation', (s) => s.trim()]];

function lineMatch(text, search, norm) {
  const fl = text.split('\n');
  const sl = search.split('\n');
  while (sl.length > 1 && sl.at(-1).trim() === '') sl.pop();
  const want = sl.map(norm);
  const hits = [];
  for (let i = 0; i + want.length <= fl.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length; j++) if (norm(fl[i + j]) !== want[j]) { ok = false; break; }
    if (ok) hits.push(i);
  }
  if (hits.length !== 1) return { n: hits.length, lines: hits.map((i) => i + 1), len: want.length };
  const i = hits[0];
  const start = fl.slice(0, i).reduce((a, l) => a + l.length + 1, 0);
  const end = start + fl.slice(i, i + want.length).join('\n').length;
  return { n: 1, start, end };
}

const lineOf = (text, at) => text.slice(0, at).split('\n').length;
const listLines = (lines) => `line${lines.length > 1 ? 's' : ''} ${lines.slice(0, 10).join(', ')}${lines.length > 10 ? ', ...' : ''}`;
const show = (s) => (s.length > 160 ? `${s.slice(0, 160)} ...` : s);

// For each hit, the nearest line above or below it that is not the same at every hit,
// so the hits can be told apart without re-reading the file.
function tellApart(text, starts, len, reach = 10) {
  const fl = text.split('\n');
  const hits = starts.slice(0, 10);
  for (let d = 1; d <= reach; d++) {
    for (const [side, at] of [['above', (s) => s - d], ['below', (s) => s + len - 1 + d]]) {
      const got = hits.map((s) => fl[at(s) - 1]);
      if (new Set(got.map((l) => l?.trim())).size < 2) continue;
      return hits.map((s, k) => `\n  line ${s}, ${d} line${d > 1 ? 's' : ''} ${side}: ${got[k] === undefined ? '(outside the file)' : show(got[k].trim())}`).join('');
    }
  }
  return `\n  The matched text and the ${reach} lines above and below it are the same at every hit.`;
}

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) ?? 0) + 1); }
  return m;
}
function dice(a, b) {
  if (a.s === b.s) return 1;
  if (a.s.length < 2 || b.s.length < 2) return 0;
  let both = 0;
  for (const [k, n] of a.g) both += Math.min(n, b.g.get(k) ?? 0);
  return (2 * both) / (a.s.length + b.s.length - 2);
}

// The window of the file most like SEARCH, scored line by line: equal lines score 1,
// others by shared character pairs. null when no window averages half or better.
function closest(text, search) {
  const fl = text.split('\n');
  const sl = search.split('\n');
  while (sl.length > 1 && sl.at(-1).trim() === '') sl.pop();
  const n = Math.min(sl.length, fl.length);
  if (fl.length * n > 1e6) return null;
  const prep = (l) => { const s = l.trim(); return { s, g: bigrams(s) }; };
  const F = fl.map(prep), S = sl.map(prep);
  let best = 0, at = -1;
  for (let i = 0; i + n <= fl.length; i++) {
    let score = 0;
    for (let j = 0; j < n; j++) score += dice(F[i + j], S[j]);
    if (score > best) { best = score; at = i; }
  }
  if (at < 0 || best / sl.length < 0.5) return null;
  const first = S.findIndex((x, j) => j >= n || F[at + j].s !== x.s);
  return { fl, sl, start: at, len: n, first };
}

// Why SEARCH did not match, in the order the causes turned up in real failures.
function notFound(text, block, where, orig) {
  const s = block.search;
  const out = [`${where}: SEARCH text not found.`];
  const done = () => new PatchError(out.join('\n'));
  if (s.split('\n')[0].trim() === 'all') {
    out.push('  Its first line is "all". To replace every match, put it on the marker line: "<<<<<<< SEARCH all".');
    return done();
  }
  if (s.includes('\\') && text.includes('\\\\')) {
    const c = countExact(text.replaceAll('\\\\', '\\'), s);
    if (c.n > 0) {
      out.push(`  It matches at line ${c.lines[0]} once each "\\\\" in the file is read as "\\". The Bash tool on Windows halves backslash pairs, even in a quoted heredoc, so REPLACE lost them too. Write the patch to a file and pass --file.`);
      return done();
    }
  }
  if (orig !== undefined && orig !== text && countExact(orig, s).n > 0) {
    out.push('  It matches the file as it was before an earlier block in this patch changed it. Write this block against the text that block leaves behind.');
  }
  const r = block.replace;
  if (r !== s && r.trim().length >= 40) {
    const a = countExact(text, r);
    if (a.n === 1) out.push(`  The REPLACE text is already in the file at line ${a.lines[0]}; this edit may already be applied.`);
  }
  const near = closest(text, s);
  if (!near) {
    out.push(`  SEARCH starts with: ${show(s.split('\n')[0])}`, '  Nothing in the file is close to it. Re-read the file and copy SEARCH from it.');
    return done();
  }
  const { fl, sl, start, len, first } = near;
  if (first >= 0) {
    out.push(`  SEARCH line ${first + 1} is the first that differs from file line ${start + first + 1}:`);
    out.push(`    SEARCH: ${sl[first]}`, `    file:   ${first < len ? fl[start + first] : '(end of file)'}`);
  }
  const shown = Math.min(len, 20), width = String(start + shown).length;
  out.push(`  Closest text in the file, lines ${start + 1}-${start + len}. Copy it into SEARCH rather than retyping it:`);
  for (let k = start; k < start + shown; k++) out.push(`    ${String(k + 1).padStart(width)} | ${fl[k]}`);
  if (len > shown) out.push('    ...');
  return done();
}

function splice(text, start, end, replace) {
  // An empty replacement of whole lines removes the lines, not just their text.
  if (replace === '' && (start === 0 || text[start - 1] === '\n') && text[end] === '\n') end++;
  return text.slice(0, start) + replace + text.slice(end);
}

function applyBlock(doc, block, path, orig) {
  const where = `${path} block at patch line ${block.line}`;
  if (block.search.trim() === '') throw new PatchError(`${where}: SEARCH is empty; use "*** Create" or "*** Append" to add text`);
  const exact = countExact(doc.text, block.search);
  if (block.all) {
    if (exact.n === 0) throw notFound(doc.text, block, where, orig);
    doc.text = doc.text.split(block.search).join(block.replace);
    return `${exact.n} replacements, exact`;
  }
  if (exact.n > 1) throw new PatchError(`${where}: SEARCH text matches ${exact.n} times (${listLines(exact.lines)}); add surrounding lines to make it unique, or use "<<<<<<< SEARCH all"${tellApart(doc.text, exact.lines, block.search.split('\n').length)}`);
  // "    y = 1" also occurs inside "        y = 1"; splicing there would stack the
  // replacement's indentation on top of the file's. Treat that as not found exactly.
  const lineStart = doc.text.lastIndexOf('\n', exact.at - 1) + 1;
  const midIndent = exact.n === 1 && /^[ \t]/.test(block.search) && exact.at > lineStart && /^[ \t]+$/.test(doc.text.slice(lineStart, exact.at));
  if (exact.n === 1 && !midIndent) {
    doc.text = splice(doc.text, exact.at, exact.at + block.search.length, block.replace);
    return `line ${lineOf(doc.text, exact.at)}, exact`;
  }
  for (const [name, norm] of STRATEGIES) {
    const m = lineMatch(doc.text, block.search, norm);
    if (m.n > 1) throw new PatchError(`${where}: SEARCH text not found exactly, and matches ${m.n} times ignoring ${name} (${listLines(m.lines)}); add surrounding lines${tellApart(doc.text, m.lines, m.len)}`);
    if (m.n === 1) {
      doc.text = splice(doc.text, m.start, m.end, block.replace);
      return `line ${lineOf(doc.text, m.start)}, matched ignoring ${name}`;
    }
  }
  throw notFound(doc.text, block, where, orig);
}

// A path that resolves to nothing usually means the shell's cwd moved (a `cd` into a
// subfolder). Name the one existing file it most likely meant; never use it.
function missing(rel, abs, cwd) {
  const out = `${rel}: file not found (looked for ${abs.replaceAll('\\', '/')}; cwd is ${cwd.replaceAll('\\', '/')})`;
  const found = new Set();
  for (let d = dirname(cwd), up = cwd, k = 0; d !== up && k < 8; up = d, d = dirname(d), k++) {
    const p = resolve(d, rel);
    if (existsSync(p)) found.add(p);
  }
  const parts = rel.split('/').filter((x) => x && x !== '.');
  const tail = cwd.split(/[\\/]/).filter(Boolean);
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  for (let k = 1; k < parts.length && k <= tail.length; k++) {
    if (!same(parts.slice(0, k).join('/'), tail.slice(-k).join('/'))) continue;
    const p = resolve(cwd, parts.slice(k).join('/'));
    if (existsSync(p)) found.add(p);
  }
  if (found.size !== 1) return out;
  return `${out}\n  Did you mean ${relative(cwd, [...found][0]).replaceAll('\\', '/')}? (not applied)`;
}

// Builds every file's new content in memory. Throws on the first problem; nothing is written.
export function planPatch(ops, cwd = process.cwd()) {
  const files = new Map(); // abs path -> { doc | null (deleted), created, orig }
  const report = [];
  const load = (abs, rel) => {
    if (files.has(abs)) {
      const f = files.get(abs);
      if (!f.doc) throw new PatchError(`${rel}: already deleted earlier in this patch`);
      return f;
    }
    if (!existsSync(abs)) throw new PatchError(missing(rel, abs, cwd));
    const doc = decode(readFileSync(abs, 'utf8'));
    const f = { doc, created: false, orig: doc.text };
    files.set(abs, f);
    return f;
  };
  for (const op of ops) {
    const abs = resolve(cwd, op.path);
    if (op.kind === 'create') {
      if ((files.has(abs) && files.get(abs).doc) || (!files.has(abs) && existsSync(abs))) throw new PatchError(`${op.path}: already exists; use "*** Update" to change it`);
      files.set(abs, { doc: { text: op.content, bom: false, eol: '\n' }, created: true });
      report.push(`created  ${op.path} (${op.content.split('\n').length - 1} lines)`);
    } else if (op.kind === 'delete') {
      load(abs, op.path).doc = null;
      report.push(`deleted  ${op.path}`);
    } else if (op.kind === 'append') {
      const f = load(abs, op.path);
      if (f.doc.text !== '' && !f.doc.text.endsWith('\n')) f.doc.text += '\n';
      f.doc.text += op.content;
      report.push(`appended ${op.path} (${op.content.split('\n').length - 1} lines)`);
    } else {
      const f = load(abs, op.path);
      op.blocks.forEach((b, k) => report.push(`updated  ${op.path} #${k + 1}: ${applyBlock(f.doc, b, op.path, f.orig)}`));
    }
  }
  return { files, report };
}

function writeAtomic(abs, data) {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.apply-patch.tmp`;
  writeFileSync(tmp, data, 'utf8');
  try { renameSync(tmp, abs); } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EBUSY') { try { unlinkSync(tmp); } catch {} throw e; }
    try { renameSync(tmp, abs); } catch (e2) { try { unlinkSync(tmp); } catch {} throw e2; } // Windows watcher collision: retry once
  }
}

export function commit({ files }) {
  for (const [abs, f] of files) {
    if (f.doc === null) { if (existsSync(abs)) unlinkSync(abs); continue; }
    writeAtomic(abs, encode(f.doc));
  }
}

function main(argv) {
  const args = argv.slice(2);
  const dry = args.includes('--dry-run');
  const keep = args.includes('--keep');
  const fi = args.indexOf('--file');
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('usage: apply-patch [--file <patch> [--keep]] [--dry-run]   (patch on stdin when --file is absent; --file deletes the patch once it applies unless --keep)\n');
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
    plan = planPatch(parsePatch(text));
  } catch (e) {
    if (!(e instanceof PatchError)) throw e;
    process.stderr.write(`apply-patch: ${e.message}\nNo files were changed.\n`);
    return 1;
  }
  if (!dry) commit(plan);
  // An applied patch file is spent. Left on disk, Claude Code re-attaches it to the
  // context after every compaction as a recently written file.
  let removed = '';
  if (!dry && !keep && fi >= 0) {
    try { unlinkSync(args[fi + 1]); removed = `; removed ${args[fi + 1].replaceAll('\\', '/')}`; } catch { /* already gone or locked: harmless */ }
  }
  process.stdout.write(plan.report.join('\n') + `\n${dry ? 'dry run: nothing written' : `ok: ${plan.files.size} file(s)${removed}`}\n`);
  return 0;
}

// realpath: when run through the ~/.claude/scripts junction, argv[1] is the junction path.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv);
