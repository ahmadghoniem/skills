// After a successful apply-patch, the bash tool rewrites apply-patch's per-block report
// into one line per updated file, with the lines each block landed on and the lines
// added and removed:
//
//   updated  src/ui/types.ts: 2 blocks (lines 7, 32), +6/-0 lines
//
// agy's own edit_file reports the same way ("Made 1 replacement in ... starting at line
// 7 (+5/-0 lines)"). The counts come from the file's contents read just before the call
// and just after it, so only this call's changes count, not the user's uncommitted work.
// apply-patch itself is not changed: Claude Code runs the same file and keeps its report.

const REPORT = /^updated  (.+) #(\d+): (.+)$/;

/**
 * Lines added and removed between two versions of a file. Common lines at both ends are
 * set aside first; the rest is an LCS, or both sides counted whole when it is too large.
 * @param {string} before
 * @param {string} after
 * @returns {{ add: number, del: number, approx: boolean }}
 */
export function lineDelta(before, after) {
  const x = before.replace(/\r\n/g, '\n').split('\n');
  const y = after.replace(/\r\n/g, '\n').split('\n');
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  const m = x.slice(p, x.length - s);
  const n = y.slice(p, y.length - s);
  if (!m.length || !n.length) return { add: n.length, del: m.length, approx: false };
  if (m.length * n.length > 4_000_000) return { add: n.length, del: m.length, approx: true };
  let prev = new Uint32Array(n.length + 1);
  let cur = new Uint32Array(n.length + 1);
  for (let i = 0; i < m.length; i++) {
    for (let j = 0; j < n.length; j++) cur[j + 1] = m[i] === n[j] ? prev[j] + 1 : Math.max(prev[j + 1], cur[j]);
    [prev, cur] = [cur, prev];
  }
  const lcs = prev[n.length];
  return { add: n.length - lcs, del: m.length - lcs, approx: false };
}

/**
 * Rewrite apply-patch's `updated <path> #k: ...` lines in a bash result into one line
 * per file. Other lines, including `created`, `deleted`, `appended`, `ok:` and anything
 * the command printed, are left as they are.
 * @param {string} text the bash result
 * @param {(path: string) => { before?: string, after?: string }} contents the file's
 *   text before and after the call, by the path as the patch wrote it
 * @returns {string}
 */
export function summarizePatch(text, contents) {
  if (!/^(ok|partial): \d+ file/m.test(text)) return text;
  const lines = text.split('\n');
  const files = new Map();
  lines.forEach((line, i) => {
    const m = line.replace(/\r$/, '').match(REPORT);
    if (!m) return;
    const [, path, k, how] = m;
    if (!files.has(path)) files.set(path, { at: i, blocks: [] });
    files.get(path).blocks.push({ k: Number(k), how });
  });
  if (!files.size) return text;
  const drop = new Set();
  for (const [path, f] of files) {
    const where = [];
    const notes = [];
    for (const b of f.blocks) {
      const line = b.how.match(/^line (\d+), (.+)$/);
      const all = b.how.match(/^(\d+) replacements, (.+)$/);
      if (line) where.push(line[1]);
      else if (all) where.push(`${all[1]} places`);
      else where.push(`#${b.k}`);
      const match = (line ?? all)?.[2] ?? b.how;
      if (match !== 'exact') notes.push(`#${b.k} ${match}`);
    }
    const n = f.blocks.length;
    let delta = '';
    const { before, after } = contents(path);
    if (before !== undefined && after !== undefined) {
      const d = lineDelta(before, after);
      delta = `, ${d.approx ? 'about ' : ''}+${d.add}/-${d.del} lines`;
    }
    const note = notes.length ? `; ${notes.join('; ')}` : '';
    const label = where.every((w) => /^\d+$/.test(w)) ? (where.length === 1 ? 'line ' : 'lines ') : '';
    lines[f.at] = `updated  ${path}: ${n} block${n === 1 ? '' : 's'} (${label}${where.join(', ')})${delta}${note}`;
    lines.forEach((line, i) => {
      if (i !== f.at && line.replace(/\r$/, '').match(REPORT)?.[1] === path) drop.add(i);
    });
  }
  return lines.filter((_, i) => !drop.has(i)).join('\n');
}
