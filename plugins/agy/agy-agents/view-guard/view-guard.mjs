#!/usr/bin/env node
// agy PreToolUse/PostToolUse hook for view_file. It keeps, per conversation,
// the line ranges of each file already shown to the model, and:
// - denies a view whose lines were all shown before;
// - trims a view that partly overlaps them to the lines not yet shown;
// - widens a window on an unseen file that fits in one view to the whole file.
// A file whose size or mtime changed since it was shown starts over, and a
// view that failed is forgotten. Decisions go to the state file's `log`.
// usage (from hooks.json): node view-guard.mjs pre|post
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** view_file's own limits per call. */
export const MAX_LINES = 800;
export const MAX_BYTES = 46_080;

/**
 * Line count and, for each line, the byte offset where it ends.
 *
 * @param {string} text
 */
export function lineEnds(text) {
  const ends = [];
  let bytes = 0;
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  for (const l of lines) {
    bytes += Buffer.byteLength(l, 'utf8') + 1;
    ends.push(bytes);
  }
  return ends;
}

/**
 * The lines view_file will show for a request, capped at its line and byte limits.
 *
 * @param {number[]} ends from `lineEnds`
 * @param {number=} start
 * @param {number=} end
 * @returns {[number, number]}
 */
export function shownRange(ends, start, end) {
  const total = ends.length;
  const s = Math.max(1, start ?? 1);
  let e = Math.min(total, end ?? total, s + MAX_LINES - 1);
  const base = s > 1 ? ends[s - 2] : 0;
  while (e > s && ends[e - 1] - base > MAX_BYTES) e--;
  return [s, e];
}

/**
 * Parts of [s, e] not covered by `seen`.
 *
 * @param {[number, number]} range
 * @param {Array<[number, number]>} seen
 * @returns {Array<[number, number]>}
 */
export function unseen([s, e], seen) {
  let parts = [[s, e]];
  for (const [a, b] of seen) {
    parts = parts.flatMap(([x, y]) => {
      if (b < x || a > y) return [[x, y]];
      const out = [];
      if (a > x) out.push([x, a - 1]);
      if (b < y) out.push([b + 1, y]);
      return out;
    });
  }
  return parts;
}

/**
 * Decide on one view_file call and update `state` in place.
 *
 * @param {{files: Record<string, any>, log: any[]}} state
 * @param {{path: string, size: number, mtimeMs: number, text: string, start?: number, end?: number, step: number}} call
 * @returns {{decision: 'allow'|'deny', reason?: string, overwrite?: {StartLine: number, EndLine: number}}}
 */
export function decide(state, call) {
  const key = call.path.replace(/\\/g, '/').toLowerCase();
  let rec = state.files[key];
  if (!rec || rec.size !== call.size || rec.mtimeMs !== call.mtimeMs) {
    rec = state.files[key] = { size: call.size, mtimeMs: call.mtimeMs, seen: [] };
  }
  const ends = lineEnds(call.text);
  const total = ends.length;
  /** @type {{decision: 'allow'|'deny', reason?: string, overwrite?: {StartLine: number, EndLine: number}}} */
  let out = { decision: 'allow' };
  let range = shownRange(ends, call.start, call.end);

  const whole = shownRange(ends);
  if (rec.seen.length === 0 && whole[1] === total && (range[0] !== 1 || range[1] !== total)) {
    range = whole;
    out = { decision: 'allow', overwrite: { StartLine: 1, EndLine: total } };
  } else if (total > 0) {
    const parts = unseen(range, rec.seen.map((r) => [r[0], r[1]]));
    if (parts.length === 0) {
      const steps = [...new Set(rec.seen.filter((r) => r[0] <= range[1] && r[1] >= range[0]).map((r) => r[2]))];
      const name = call.path.replace(/\\/g, '/').split('/').pop();
      out = {
        decision: 'deny',
        reason:
          `Lines ${range[0]}-${range[1]} of ${name} were already shown to you (step ${steps.join(', ')}) ` +
          `and are still in your context. Use them; view only lines you have not seen. ${name} has ${total} lines.`,
      };
      state.log.push({ step: call.step, path: call.path, asked: [call.start ?? null, call.end ?? null], decision: 'deny' });
      return out;
    }
    const s = parts[0][0];
    const e = parts[parts.length - 1][1];
    if (s !== range[0] || e !== range[1]) {
      range = shownRange(ends, s, e);
      out = { decision: 'allow', overwrite: { StartLine: range[0], EndLine: range[1] } };
    }
  }
  rec.seen.push([range[0], range[1], call.step]);
  state.log.push({
    step: call.step,
    path: call.path,
    asked: [call.start ?? null, call.end ?? null],
    decision: out.overwrite ? 'overwrite' : 'allow',
    shown: range,
  });
  return out;
}

/**
 * Forget the ranges recorded for a step whose view failed.
 *
 * @param {{files: Record<string, any>, log: any[]}} state
 * @param {number} step
 */
export function forgetStep(state, step) {
  for (const rec of Object.values(state.files)) rec.seen = rec.seen.filter((r) => r[2] !== step);
  state.log.push({ step, decision: 'failed' });
}

export function stateDir() {
  return process.env.AGY_VIEW_GUARD_DIR || join(homedir(), '.cad', 'view-guard');
}

function main() {
  const event = process.argv[2];
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const id = String(input.conversationId || 'unknown').replace(/[^\w-]/g, '');
  const dir = stateDir();
  const file = join(dir, `${id}.json`);
  const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { files: {}, log: [] };
  let out = {};
  if (event === 'pre') {
    out = { decision: 'allow' };
    const args = input.toolCall?.args ?? {};
    const path = args.AbsolutePath;
    if (input.toolCall?.name === 'view_file' && typeof path === 'string' && existsSync(path)) {
      const st = statSync(path);
      if (st.isFile()) {
        out = decide(state, {
          path,
          size: st.size,
          mtimeMs: st.mtimeMs,
          text: readFileSync(path, 'utf8'),
          start: typeof args.StartLine === 'number' ? args.StartLine : undefined,
          end: typeof args.EndLine === 'number' ? args.EndLine : undefined,
          step: input.stepIdx ?? -1,
        });
      }
    }
  } else if (event === 'post' && input.error) {
    forgetStep(state, input.stepIdx ?? -1);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(state), 'utf8');
  process.stdout.write(JSON.stringify(out));
}

// Self-contained: installAgent copies this folder next to the agent file.
function invokedAsScript() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  try {
    main();
  } catch {
    // A broken guard must never block a read.
    process.stdout.write(JSON.stringify(process.argv[2] === 'pre' ? { decision: 'allow' } : {}));
  }
}
