// Small on-disk cache of what's been learned about specific Cursor model ids
// (capability tier, a one-line note on strengths, where/when it was learned).
// This exists because `MODEL_ALIASES` (lib/cursor.mjs) deliberately no longer
// hardcodes per-vendor model knowledge — that table went stale the moment
// Cursor shipped a new build. Instead, the invoking agent is expected to:
//   1. call `listModels()` for the live id list,
//   2. for any id not already in this cache, do ONE web lookup restricted to
//      cursor.com to learn its tier/strengths, and
//   3. write the result here via `mergeNote()` so future runs skip the
//      lookup.
// See `commands/delegate.md` and `agents/cursor-runner.md` for the full
// runtime model-selection flow this cache supports.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, pluginHome } from './paths.mjs';

/**
 * @typedef {Object} ModelNote
 * @property {string=} tier      Coarse capability tier, e.g. "fast" | "balanced" | "frontier".
 * @property {string=} note      One-line human-readable summary of strengths/fit.
 * @property {string=} fetchedOn ISO date the note was learned/refreshed.
 * @property {string=} source    Where the note came from, e.g. a cursor.com URL.
 */

function notesPath() {
  return join(pluginHome(), 'model-notes.json');
}

/**
 * @returns {string} Absolute path to the cache file (for docs/debugging).
 */
export function notesFilePath() {
  return notesPath();
}

/**
 * Read the full model-notes cache. Never throws — a missing or corrupted
 * cache file is treated as empty so a bad cache can't block delegation.
 *
 * @returns {Record<string, ModelNote>}
 */
export function readNotes() {
  const file = notesPath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeNotes(notes) {
  ensureDir(pluginHome());
  writeFileSync(notesPath(), JSON.stringify(notes, null, 2), 'utf8');
}

/**
 * Merge a partial note into the cache entry for `id` and persist it.
 *
 * @param {string} id
 * @param {ModelNote} entry
 * @returns {Record<string, ModelNote>} The full, updated cache.
 */
export function mergeNote(id, entry) {
  const notes = readNotes();
  notes[id] = { ...notes[id], ...entry };
  writeNotes(notes);
  return notes;
}

/**
 * Drop the entire cache — backs `/cursor:setup --refresh-models`.
 *
 * @returns {void}
 */
export function clearNotes() {
  writeNotes({});
}
