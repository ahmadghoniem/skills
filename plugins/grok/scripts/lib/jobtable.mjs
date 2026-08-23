import { mdCell } from './md.mjs';

/**
 * Human-readable age of an ISO timestamp, relative to now.
 *
 * @param {string} iso
 * @returns {string}
 */
export function age(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function truncate(s, n) {
  const clean = mdCell(s);
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
}

/**
 * Render tracked jobs as a compact Markdown table. Shared by `status.mjs` (run
 * directly) and `/cursor:result --list`, so both listings stay identical.
 *
 * @param {Array<Record<string, any>>} rows
 * @returns {string}
 */
export function renderJobTable(rows) {
  if (rows.length === 0) return 'No Grok jobs tracked for this repository yet.\n';
  const header = '| ID | Status | Model | Age | Prompt |';
  const sep = '| --- | --- | --- | --- | --- |';
  const body = rows
    .map(
      (r) =>
        `| \`${r.id}\` | ${mdCell(r.status)} | ${mdCell(r.model)} | ${age(r.startedAt)} | ${truncate(
          r.prompt,
          60,
        )} |`,
    )
    .join('\n');
  return `${header}\n${sep}\n${body}\n`;
}
