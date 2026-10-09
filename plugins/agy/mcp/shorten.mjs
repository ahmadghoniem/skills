// Fit a tool result under agy's limit. agy keeps about the first and last
// 5,000 characters of any MCP result and drops the middle, with only a link to
// the full text that the model does not follow. Cutting here first lets the
// note say which lines went missing, what they held, and how to read them.

/** Characters a result may use, leaving room under agy's ~10,000. */
export const BUDGET = 9_000;
const HEAD = 5_500;
const TAIL = 2_500;
const LIST_CHARS = 700;

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
 * `a (3), b (1), … and N more`, kept under LIST_CHARS.
 *
 * @param {Map<string, number>} counts
 * @returns {string}
 */
function countList(counts) {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const parts = [];
  let used = 0;
  for (const [name, n] of sorted) {
    const part = `${name} (${n})`;
    if (used + part.length > LIST_CHARS) break;
    parts.push(part);
    used += part.length + 2;
  }
  const rest = sorted.length - parts.length;
  return parts.join(', ') + (rest ? `, and ${rest} more` : '');
}

/**
 * What the cut lines held, when they look like rg matches or a list of paths.
 *
 * rg prints `path:line:text` for a match when piped, or a `path` heading
 * followed by `line:text` with `--heading`. `before` is the text above the cut,
 * so a heading printed there still names the cut lines under it.
 *
 * @param {string[]} cut
 * @param {string[]} before
 * @returns {string} a sentence, or '' when the lines have no shape to report
 */
export function describeCut(cut, before = []) {
  /** @type {Map<string, number>} */
  const byFile = new Map();
  let matches = 0;
  let heading = '';
  for (const l of before) {
    if (l && !/^\d+[:-]/.test(l) && l !== '--') heading = l;
  }
  for (const l of cut) {
    const flat = l.match(/^(.+?):(\d+):/);
    let file = '';
    if (flat && !/^\d+$/.test(flat[1])) file = flat[1];
    else if (/^\d+:/.test(l) && heading) file = heading;
    else if (l && !/^\d+-/.test(l) && l !== '--') heading = l;
    if (!file) continue;
    matches += 1;
    byFile.set(file, (byFile.get(file) ?? 0) + 1);
  }
  const nonEmpty = cut.filter((l) => l.trim()).length;
  if (matches && matches >= nonEmpty * 0.3) {
    return `They hold ${matches} matching line${matches === 1 ? '' : 's'} in ${byFile.size} file${byFile.size === 1 ? '' : 's'}: ${countList(byFile)}.`;
  }

  // A file listing (rg --files, find, ls -R): count by directory.
  const paths = cut.filter((l) => l.trim());
  if (paths.length && paths.every((l) => /[\\/]/.test(l) && !/:\d+[:-]/.test(l) && l.length < 300)) {
    /** @type {Map<string, number>} */
    const byDir = new Map();
    for (const p of paths) {
      const dir = p.replace(/\\/g, '/').replace(/\/[^/]*$/, '/') || './';
      byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
    }
    return `They list ${paths.length} paths by directory: ${countList(byDir)}.`;
  }
  return '';
}

/**
 * Shorten `text` to about BUDGET characters, keeping whole lines from both ends
 * and putting a note where the middle was.
 *
 * @param {string} text
 * @param {string} savedPath where the full text was written, shown in the note
 * @param {number} [budget]
 * @returns {string}
 */
export function shorten(text, savedPath, budget = BUDGET) {
  if (text.length <= budget) return text;
  const lines = text.split('\n');
  const scale = budget / BUDGET;
  let head = fit(lines, HEAD * scale, false);
  let tail = fit(lines.slice(head), TAIL * scale, true);
  // A single line longer than the budget: keep its start.
  if (head === 0 && tail === 0) {
    return `${text.slice(0, Math.floor(budget * 0.8))}\n[cut: this output is ${text.length} characters on ${lines.length} line${lines.length === 1 ? '' : 's'}. Full output: ${savedPath}]`;
  }
  const from = head + 1;
  const to = lines.length - tail;
  const cut = lines.slice(head, to);
  const what = describeCut(cut, lines.slice(0, head));
  const note = [
    `[cut to fit agy's limit: lines ${from}-${to} of ${lines.length} are not shown (${cut.join('\n').length} characters).${what ? ` ${what}` : ''}`,
    ` Full output: ${savedPath} . Read the missing lines with view_file from line ${from}, or narrow the command.]`,
  ].join('\n');
  return [...lines.slice(0, head), note, ...lines.slice(to)].join('\n');
}
