// grok's side of the papercut log: which warnings become rows. Storing,
// grouping and closing rows is shared (`shared/papercuts.mjs`).
import { readFileSync } from 'node:fs';
import { appendPapercut, oneLine } from './shared/papercuts.mjs';
import { papercutsPath } from './paths.mjs';

/** The plugin's version, stamped on every row. */
export const pluginVersion = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

/**
 * Only `error-detail` is filed: `stop-reason` and `exit` restate it, and fire
 * on runs whose work landed.
 *
 * @param {{id: string, line: string, detail?: string[]}[]} warningList
 * @param {{toolVersion?: string, model?: string, sessionId?: string, turns?: number, exitCode?: number, stopReason?: string}} ctx
 */
export function recordDetected(warningList, ctx) {
  for (const w of warningList) {
    if (w.id !== 'error-detail') continue;
    appendPapercut(papercutsPath(), {
      ts: new Date().toISOString(),
      source: 'detected',
      key: 'error-detail',
      text: oneLine(w.line.replace(/^error: /, '')),
      toolVersion: ctx.toolVersion || undefined,
      pluginVersion,
      model: ctx.model || undefined,
      repo: process.cwd(),
      sessionId: ctx.sessionId,
      turns: ctx.turns,
      evidence: {
        stopReason: ctx.stopReason ?? null,
        exitCode: ctx.exitCode ?? null,
        more: w.detail?.length ? w.detail.map(oneLine).slice(0, 10) : undefined,
      },
    });
  }
}
