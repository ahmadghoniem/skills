// Fit a tool result under agy's limit. agy keeps about the first and last
// 5,000 characters of any MCP result and drops the middle, with only a link to
// the full text that the model does not follow. Cutting here first lets the
// note say which lines went missing, what they held, and how to read them.

/** Characters a result may use, leaving room under agy's ~10,000. */
export const BUDGET = 9_000;
const HEAD = 5_500;
const TAIL = 2_500;
const LIST_CHARS = 700;
// Room for the note of each cut section when the output has several.
const NOTE_ROOM = 900;
const MIN_SECTION = 600;

/**
 * Keep whole lines from the start (or end) of `lines` up to `chars` characters.
 *
 * @param {string[]} lines
 * @param {number} chars
 * @param {boolean} fromEnd
 * @returns {number} how many lines fit
 */
function fit(lines, chars, fromEnd) {
  let used = 0;
  let n = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[fromEnd ? lines.length - 1 - i : i];
    if (used + line.length + 1 > chars) break;
    used += line.length + 1;
    n += 1;
  }
  return n;
}

/**
 * `a (3), b (1), … and N more`, kept under `chars`.
 *
 * @param {Map<string, number>} counts
 * @param {number} chars
 * @returns {string}
 */
function countList(counts, chars) {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const parts = [];
  let used = 0;
  for (const [name, n] of sorted) {
    const part = `${name} (${n})`;
    if (used + part.length > chars) break;
    parts.push(part);
    used += part.length + 2;
  }
  const rest = sorted.length - parts.length;
  return parts.join(', ') + (rest ? `, and ${rest} more` : '');
}

/**
 * Whether a whole line looks like a file path: no spaces unless it is absolute,
 * and a slash or a file extension.
 *
 * @param {string} l
 */
function isPath(l) {
  if (/\s/.test(l) && !/^(?:[A-Za-z]:)?[\\/]/.test(l)) return false;
  return /[\\/]/.test(l) || /^[\w.@-]+\.\w+$/.test(l);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What the cut lines held, when they look like rg matches or a list of paths.
 *
 * rg prints `path:line:text` for a match when piped (`path-line-text` for a
 * context line), `path:text` without `-n`, or a `path` heading followed by
 * `line:text` with `--heading`. `before` is the text above the cut, so a
 * heading printed there still names the cut lines under it.
 *
 * @param {string[]} cut
 * @param {string[]} before
 * @param {number} [listChars]
 * @returns {string} a sentence, or '' when the lines have no shape to report
 */
export function describeCut(cut, before = [], listChars = LIST_CHARS) {
  /** @type {Map<string, number>} */
  const byFile = new Map();
  let matches = 0;
  let context = 0;
  // Matches with no file named: rg on a single file prints `line:text`.
  let unnamed = 0;
  let heading = '';
  for (const l of before) {
    if (l && !/^\d+[:-]/.test(l) && l !== '--') heading = l;
  }
  /** @type {string[]} */
  const rest = [];
  for (const l of cut) {
    const flat = l.match(/^(.+?):(\d+):/);
    const bare = l.match(/^((?:[A-Za-z]:)?[^:\s()]+):/);
    let file = '';
    if (flat && !/^\d+$/.test(flat[1])) file = flat[1];
    else if (/^\d+:/.test(l) && heading) file = heading;
    else if (/^\d+-/.test(l) && heading) context += 1;
    else if (bare && isPath(bare[1])) file = bare[1];
    else if (/^\d+:/.test(l)) unnamed += 1;
    else if (/^\d+-/.test(l)) context += 1;
    else if (l && l !== '--') {
      rest.push(l);
      heading = l;
    }
    if (!file) continue;
    matches += 1;
    byFile.set(file, (byFile.get(file) ?? 0) + 1);
  }
  // Context lines in the flat form name a file already seen with a match.
  for (const l of rest) {
    const m = l.match(/^(.+?)-(\d+)-/);
    if (m && byFile.has(m[1])) context += 1;
  }
  const lines = cut.filter((l) => l.trim() && l !== '--').length;
  if (matches + unnamed && matches + unnamed + context >= lines * 0.3) {
    const ctx = context ? ` (and ${plural(context, 'line')} of context)` : '';
    if (!matches) return `They hold ${plural(unnamed, 'matching line')}${ctx}.`;
    return `They hold ${plural(matches + unnamed, 'matching line')}${ctx} in ${plural(byFile.size, 'file')}: ${countList(byFile, listChars)}.`;
  }

  // A file listing (rg --files, rg -l, find): count by directory.
  const paths = cut.filter((l) => l.trim());
  if (paths.length && paths.every((l) => l.length < 300 && !/:\d+[:-]/.test(l) && isPath(l))) {
    /** @type {Map<string, number>} */
    const byDir = new Map();
    for (const p of paths) {
      const s = p.replace(/\\/g, '/');
      const dir = s.includes('/') ? s.replace(/\/[^/]*$/, '/') || '/' : './';
      byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
    }
    return `They list ${paths.length} paths by directory: ${countList(byDir, listChars)}.`;
  }
  return '';
}

/**
 * The file a command only prints, and the file line its first output line is:
 * `cat f`, `head [-n N] f`, `sed -n 'A,Bp' f`.
 *
 * @param {string} command
 * @returns {{ file: string, first: number } | null}
 */
export function readTarget(command) {
  const c = command.trim().replace(/;$/, '').trim();
  const file = (s) => s.replace(/^["']|["']$/g, '');
  let m = c.match(/^cat\s+("[^"]+"|'[^']+'|[^\s|;&<>]+)$/);
  if (m) return { file: file(m[1]), first: 1 };
  m = c.match(/^head(?:\s+-n\s*\d+|\s+-\d+)?\s+("[^"]+"|'[^']+'|[^\s|;&<>-][^\s|;&<>]*)$/);
  if (m) return { file: file(m[1]), first: 1 };
  m = c.match(/^sed\s+-n\s+["']?(\d+)(?:,\d+)?p["']?\s+("[^"]+"|'[^']+'|[^\s|;&<>]+)$/);
  if (m) return { file: file(m[2]), first: Number(m[1]) };
  return null;
}

/**
 * Split output at `== label` lines, which a script prints before each of
 * several commands. Text before the first label is a section of its own.
 *
 * @param {string[]} lines
 * @returns {number[]} start line of each section, or [] for fewer than two labels
 */
function sectionStarts(lines) {
  const starts = [];
  lines.forEach((l, i) => { if (/^== \S/.test(l)) starts.push(i); });
  if (starts.length < 2) return [];
  if (starts[0] > 0) starts.unshift(0);
  return starts;
}

/**
 * Share `budget` between sections: each gets its length when that fits an even
 * share, and the rest is split evenly between the long ones.
 *
 * @param {number[]} sizes
 * @param {number} budget
 * @returns {number[]}
 */
function shares(sizes, budget) {
  const out = sizes.map(() => 0);
  const order = sizes.map((s, i) => i).sort((a, b) => sizes[a] - sizes[b]);
  let left = budget;
  order.forEach((i, k) => {
    const even = left / (order.length - k);
    out[i] = Math.floor(Math.min(sizes[i], even));
    left -= out[i];
  });
  return out;
}

/**
 * Shorten `text` to about `budget` characters, keeping whole lines from both
 * ends and putting a note where the middle was. Output split by `== label`
 * lines is shortened section by section, so one long section does not push
 * the others out.
 *
 * @param {string} text
 * @param {string} savedPath where the full text was written, shown in the note
 * @param {number} [budget]
 * @param {{ read?: { file: string, first: number } }} [opts] `read`: the
 *   output is this file from line `first`, so the note points at the file
 * @returns {string}
 */
export function shorten(text, savedPath, budget = BUDGET, opts = {}) {
  if (text.length <= budget) return text;
  const lines = text.split('\n');
  const starts = sectionStarts(lines);
  if (!starts.length) return cutLines(lines, 0, lines.length, savedPath, budget, opts.read);

  const sections = starts.map((s, i) => lines.slice(s, starts[i + 1] ?? lines.length));
  const sizes = sections.map((s) => s.join('\n').length + 1);
  const share = shares(sizes, budget);
  return sections
    .map((s, i) => {
      if (sizes[i] <= share[i]) return s.join('\n');
      return cutLines(s, starts[i], lines.length, savedPath, Math.max(share[i] - NOTE_ROOM, MIN_SECTION));
    })
    .join('\n');
}

/**
 * @param {string[]} lines the lines to cut
 * @param {number} offset how many lines of the full output come before them
 * @param {number} total lines in the full output
 * @param {string} savedPath
 * @param {number} budget
 * @param {{ file: string, first: number }} [read]
 * @returns {string}
 */
function cutLines(lines, offset, total, savedPath, budget, read) {
  const text = lines.join('\n');
  const scale = Math.min(budget / BUDGET, 1);
  const head = fit(lines, HEAD * (budget / BUDGET), false);
  const tail = fit(lines.slice(head), TAIL * (budget / BUDGET), true);
  // A single line longer than the budget: keep its start.
  if (head === 0 && tail === 0) {
    return `${text.slice(0, Math.floor(budget * 0.8))}\n[cut: this output is ${text.length} characters on ${plural(lines.length, 'line')}. Full output: ${read ? read.file : savedPath}]`;
  }
  const from = head + 1;
  const to = lines.length - tail;
  const cut = lines.slice(head, to);
  const what = read ? '' : describeCut(cut, lines.slice(0, head), Math.round(LIST_CHARS * scale));
  const how = read
    ? ` This is ${read.file}: read its lines ${read.first + head}-${read.first + to - 1} with view_file, which shows up to 800 lines without cutting.]`
    : ` Full output: ${savedPath} . Read the missing lines with view_file from line ${offset + from}, or narrow the command.]`;
  const note = [
    `[cut to fit agy's limit: lines ${offset + from}-${offset + to} of ${total} are not shown (${cut.join('\n').length} characters).${what ? ` ${what}` : ''}`,
    how,
  ].join('\n');
  return [...lines.slice(0, head), note, ...lines.slice(to)].join('\n');
}
