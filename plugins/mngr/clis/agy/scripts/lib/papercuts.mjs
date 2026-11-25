// agy's side of the papercut log: which of a run's problems become rows.
// Storing, grouping and closing rows is shared (`shared/papercuts.mjs`).
//
// Failed tool calls are filed even though the output no longer shows them: 69
// rows of the bash tool rejecting agy's `toolAction` argument are how that
// harness bug was found (fixed in fe4f504). One row per tool, so each tool's
// failures group and close on their own.
import { readFileSync } from 'node:fs';
import { appendPapercut, oneLine } from '../../../../scripts/lib/shared/papercuts.mjs';
import { papercutsPath } from './paths.mjs';

/** The plugin's version, stamped on every row. */
export const pluginVersion = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

/**
 * agy wraps a rejected tool call's error in the same ~130 characters every time,
 * which pushes the cause (usually a path) to the end of the line.
 */
const PERMISSION_WRAPPER = /^declaring permissions: cortex tool [\w-]+: convert tool call for permissions: (?:model output error: )?(?:invalid tool call error \(\w+\) )?/;

/** Drops agy's permission wrapper, for `formatOpenPapercuts`. */
export const shortenCut = (text) => text.replace(PERMISSION_WRAPPER, '');

/**
 * Whether a stderr line repeats the run's `agy-error`, which agy prints again as
 * `error: <text>` and as an `AGY_ERROR: {...}` line.
 */
function repeatsError(line, errLine) {
  if (!errLine) return false;
  if (line.startsWith('AGY_ERROR:')) return true;
  const text = line.replace(/^error:\s*/, '');
  const first = oneLine(errLine);
  return text !== '' && first !== '' && (first.startsWith(text) || text.startsWith(first));
}

/**
 * The detected rows for a finished run: its `agy-error`, what it wrote to stderr
 * on a failed run (less the copies of that error), and its failed tool calls.
 *
 * @param {{id: string, line: string, detail?: string[]}[]} anomalyList
 * @param {{toolErrors?: {tool: string, message: string}[], toolVersion?: string, model?: string, conversationId?: string, toolCalls?: number, agyStatus?: string|null, exitCode?: number}} ctx
 */
export function detectedCuts(anomalyList, ctx) {
  const ts = new Date().toISOString();
  const row = (key, text, more, count) => ({
    ts,
    source: 'detected',
    key,
    text,
    count,
    toolVersion: ctx.toolVersion || undefined,
    pluginVersion,
    model: ctx.model || undefined,
    repo: process.cwd(),
    conversationId: ctx.conversationId || undefined,
    toolCalls: ctx.toolCalls,
    evidence: { agyStatus: ctx.agyStatus ?? null, exitCode: ctx.exitCode ?? null, more: more.length ? more : undefined },
  });
  const out = [];
  const err = anomalyList.find((a) => a.id === 'agy-error');
  if (err) out.push(row('agy-error', oneLine(err.line), (err.detail ?? []).map(oneLine).filter(Boolean).slice(0, 5)));
  const stderr = anomalyList.find((a) => a.id === 'stderr');
  if (stderr) {
    const own = (stderr.detail ?? []).map(oneLine).filter((l) => l && !repeatsError(l, err?.line));
    if (own.length) out.push(row('stderr', own[0], own.slice(1, 10)));
  }
  const byTool = new Map();
  for (const e of ctx.toolErrors ?? []) {
    const tool = String(e?.tool ?? 'unknown');
    if (!byTool.has(tool)) byTool.set(tool, []);
    byTool.get(tool).push(oneLine(e?.message));
  }
  for (const [tool, messages] of byTool) {
    const distinct = [...new Set(messages)];
    out.push(row(`tool-errors:${tool}`, distinct[0], distinct.slice(1, 4), messages.length));
  }
  return out;
}

/** Write the detected rows. Never throws. */
export function recordDetected(anomalyList, ctx) {
  try {
    for (const cut of detectedCuts(anomalyList, ctx)) appendPapercut(papercutsPath(), cut);
  } catch {
    // Logging must never fail a run.
  }
}
