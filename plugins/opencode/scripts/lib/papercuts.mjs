// opencode's side of the papercut log: its errors, and tools that could not run
// at all, one row per tool. Storing, grouping and closing rows is shared.
import { readFileSync } from 'node:fs';
import { appendPapercut, oneLine } from './shared/papercuts.mjs';
import { papercutsPath } from './paths.mjs';

export const pluginVersion = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

export function recordDetected(warningList, ctx) {
  const row = (key, text, extra = {}) =>
    appendPapercut(papercutsPath(), {
      ts: new Date().toISOString(),
      source: 'detected',
      key,
      text,
      toolVersion: ctx.toolVersion || undefined,
      pluginVersion,
      model: ctx.model || undefined,
      repo: process.cwd(),
      sessionId: ctx.sessionId,
      evidence: { exitCode: ctx.exitCode ?? null },
      ...extra,
    });
  const err = warningList.find((w) => w.id === 'error-detail');
  if (err) row('error-detail', oneLine(err.line.replace(/^error: /, '')));
  const byTool = new Map();
  for (const e of ctx.toolErrors ?? []) {
    if (!byTool.has(e.tool)) byTool.set(e.tool, []);
    byTool.get(e.tool).push(oneLine(e.message));
  }
  for (const [tool, messages] of byTool) row(`tool-errors:${tool}`, messages[0], { count: messages.length });
}
