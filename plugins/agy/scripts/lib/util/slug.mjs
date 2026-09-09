import { shortSuffix } from './id.mjs';

const MAX_SLUG_CHARS = 40;
const MAX_SLUG_WORDS = 8;

/**
 * Turn task text into a kebab slug from its leading words.
 *
 * @param {string} text
 * @returns {string}
 */
export function kebabSlug(text) {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'task';
  const parts = [];
  let len = 0;
  for (const w of words) {
    const next = parts.length === 0 ? w.length : len + 1 + w.length;
    if (parts.length > 0 && (next > MAX_SLUG_CHARS || parts.length >= MAX_SLUG_WORDS)) break;
    parts.push(w);
    len = next;
  }
  return parts.join('-') || 'task';
}

/**
 * Job name: `<kebab-slug>-<4-char suffix>`, e.g. `add-retry-to-fetchuser-a7f3`.
 *
 * @param {string} text
 * @param {string} [suffix]
 * @returns {string}
 */
export function jobName(text, suffix = shortSuffix(4)) {
  return `${kebabSlug(text)}-${suffix}`;
}
