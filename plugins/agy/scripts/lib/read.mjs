// Files Claude names for a chore with `--read`, numbered like `cat -n`, for
// the first message, so agy does not spend turns finding and reading them.
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Split `path` or `path:120-300` into the path and its line range.
 * A drive letter (`C:/x.ts`) is part of the path.
 *
 * @param {string} spec
 * @returns {{path: string, from?: number, to?: number}}
 */
export function parseReadSpec(spec) {
  const m = /^(.+?):(\d+)-(\d+)$/.exec(spec);
  if (!m) return { path: spec };
  const from = Number(m[2]);
  const to = Number(m[3]);
  if (from < 1 || to < from) throw new Error(`bad line range in ${spec}: use path:from-to with 1 <= from <= to`);
  return { path: m[1], from, to };
}

/**
 * How a path appears in the message and in the answer's citations: relative
 * to the repo root when inside it, otherwise absolute, with forward slashes.
 *
 * @param {string} abs
 * @param {string} root
 * @returns {string}
 */
function shownPath(abs, root) {
  const rel = relative(root, abs);
  const inside = rel && !rel.startsWith('..') && !isAbsolute(rel);
  return (inside ? rel : abs).replace(/\\/g, '/');
}

/**
 * One file, or a range of it, as `<file path="...">` with `cat -n` numbering.
 *
 * @param {string} spec
 * @param {string} cwd
 * @param {string} root
 * @returns {{shown: string, text: string}}
 */
export function readFileBlock(spec, cwd, root) {
  const { path, from, to } = parseReadSpec(spec);
  const abs = resolve(cwd, path);
  let raw;
  try {
    if (!statSync(abs).isFile()) throw new Error('not a file');
    raw = readFileSync(abs, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (raw.includes('\0')) throw new Error(`${path} looks binary`);
  const lines = raw.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const first = from ?? 1;
  const last = Math.min(to ?? lines.length, lines.length);
  if (from !== undefined && from > lines.length) throw new Error(`${path} has ${lines.length} lines; ${spec} starts past the end`);
  const shown = shownPath(abs, root);
  const body = lines.slice(first - 1, last).map((l, i) => `${String(first + i).padStart(6)}\t${l}`).join('\n');
  const attr = from === undefined ? '' : ` lines="${first}-${last}"`;
  return { shown: from === undefined ? shown : `${shown}:${first}-${last}`, text: `<file path="${shown}"${attr}>\n${body}\n</file>` };
}

/**
 * Every file block, joined. Throws on a path it cannot read.
 *
 * @param {{specs: string[], cwd: string, root: string}} opts
 * @returns {{text: string, files: string[]}}
 */
export function readFiles({ specs, cwd, root }) {
  const blocks = specs.map((s) => readFileBlock(s, cwd, root));
  return { text: blocks.map((b) => b.text).join('\n\n'), files: blocks.map((b) => b.shown) };
}
