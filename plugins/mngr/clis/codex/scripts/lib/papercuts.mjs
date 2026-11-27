// codex's side of the papercut log: its errors, and the notes it printed and
// carried on after. Storing, grouping and closing rows is shared.
import { readFileSync } from 'node:fs';
import { appendPapercut, oneLine } from '../../../../scripts/lib/shared/papercuts.mjs';
import { papercutsPath } from './paths.mjs';

export const pluginVersion = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

export function recordDetected(warningList, ctx) {
  const row = (key, text) =>
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
    });
  const err = warningList.find((w) => w.id === 'error-detail');
  if (err) row('error-detail', oneLine(err.line.replace(/^error: /, '')));
  for (const note of new Set(ctx.notes ?? [])) row('note', oneLine(note));
}
