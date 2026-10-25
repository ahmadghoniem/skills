#!/usr/bin/env node
// Batch file edits for agents: SEARCH/REPLACE blocks across several files, checked
// in memory first and written only if every block applies. See README.md.
import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADER = /^\*\*\* (Update|Create|Delete|Append): (.+?)\s*$/;
const SEARCH = /^<<<<<<< SEARCH( all)?\s*$/;
const DIVIDER = /^=======\s*$/;
const REPLACE = /^>>>>>>> REPLACE\s*$/;

export class PatchError extends Error {}

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
        if (REPLACE.test(lines[i]) || HEADER.test(lines[i])) throw new PatchError(`line ${start}: SEARCH block has no "=======" divider`);
        search.push(lines[i++]);
      }
      if (i >= lines.length) throw new PatchError(`line ${start}: SEARCH block has no "=======" divider`);
      i++;
      while (i < lines.length && !REPLACE.test(lines[i])) {
        if (HEADER.test(lines[i]) || SEARCH.test(lines[i])) throw new PatchError(`line ${start}: block has no ">>>>>>> REPLACE" end marker`);
        replace.push(lines[i++]);
      }
      if (i >= lines.length) throw new PatchError(`line ${start}: block has no ">>>>>>> REPLACE" end marker`);
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
  if (hits.length !== 1) return { n: hits.length, lines: hits.map((i) => i + 1) };
  const i = hits[0];
  const start = fl.slice(0, i).reduce((a, l) => a + l.length + 1, 0);
  const end = start + fl.slice(i, i + want.length).join('\n').length;
  return { n: 1, start, end };
}

const lineOf = (text, at) => text.slice(0, at).split('\n').length;
const preview = (s) => JSON.stringify(s.split('\n')[0].slice(0, 60));
const listLines = (lines) => `line${lines.length > 1 ? 's' : ''} ${lines.slice(0, 10).join(', ')}${lines.length > 10 ? ', ...' : ''}`;

function splice(text, start, end, replace) {
  // An empty replacement of whole lines removes the lines, not just their text.
  if (replace === '' && (start === 0 || text[start - 1] === '\n') && text[end] === '\n') end++;
  return text.slice(0, start) + replace + text.slice(end);
}

function applyBlock(doc, block, path) {
  const where = `${path} block at patch line ${block.line}`;
  if (block.search.trim() === '') throw new PatchError(`${where}: SEARCH is empty; use "*** Create" or "*** Append" to add text`);
  const exact = countExact(doc.text, block.search);
  if (block.all) {
    if (exact.n === 0) throw new PatchError(`${where}: SEARCH text not found: ${preview(block.search)}`);
    doc.text = doc.text.split(block.search).join(block.replace);
    return `${exact.n} replacements, exact`;
  }
  if (exact.n > 1) throw new PatchError(`${where}: SEARCH text matches ${exact.n} times (${listLines(exact.lines)}); add surrounding lines to make it unique, or use "<<<<<<< SEARCH all"`);
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
    if (m.n > 1) throw new PatchError(`${where}: SEARCH text not found exactly, and matches ${m.n} times ignoring ${name} (${listLines(m.lines)}); add surrounding lines`);
    if (m.n === 1) {
      doc.text = splice(doc.text, m.start, m.end, block.replace);
      return `line ${lineOf(doc.text, m.start)}, matched ignoring ${name}`;
    }
  }
  throw new PatchError(`${where}: SEARCH text not found: ${preview(block.search)}`);
}

// Builds every file's new content in memory. Throws on the first problem; nothing is written.
export function planPatch(ops, cwd = process.cwd()) {
  const files = new Map(); // abs path -> { doc | null (deleted), created }
  const report = [];
  const load = (abs, rel) => {
    if (files.has(abs)) {
      const f = files.get(abs);
      if (!f.doc) throw new PatchError(`${rel}: already deleted earlier in this patch`);
      return f;
    }
    if (!existsSync(abs)) throw new PatchError(`${rel}: file not found`);
    const f = { doc: decode(readFileSync(abs, 'utf8')), created: false };
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
      op.blocks.forEach((b, k) => report.push(`updated  ${op.path} #${k + 1}: ${applyBlock(f.doc, b, op.path)}`));
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
  const fi = args.indexOf('--file');
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('usage: apply-patch [--file <patch>] [--dry-run]   (patch on stdin when --file is absent)\n');
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
  process.stdout.write(plan.report.join('\n') + `\n${dry ? 'dry run: nothing written' : `ok: ${plan.files.size} file(s)`}\n`);
  return 0;
}

// realpath: when run through the ~/.claude/scripts junction, argv[1] is the junction path.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv);
