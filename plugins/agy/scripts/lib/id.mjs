// URL-safe random id generator of specified length.
import { randomBytes } from 'node:crypto';

/**
 * Generate a URL-safe random id (base64url alphabet) of exactly `length`
 * characters (default 10).
 *
 * @param {number} [length]
 * @returns {string}
 */
export function id(length = 10) {
  const n = Math.max(1, length);
  const bytes = Math.ceil((n * 3) / 4) + 1;
  return randomBytes(bytes).toString('base64url').slice(0, n);
}

const ALPHANUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Lowercase alphanumeric suffix for job names (`a7f3`).
 *
 * Must remain lowercase alphanumeric: job names are lowercased by `kebabSlug`,
 * and `matchQuery` in `jobs.mjs` resolves a 4-char suffix with case-sensitive
 * `endsWith`. A mixed-case base64url suffix from `id()` would break suffix
 * lookup.
 *
 * @param {number} [length]
 * @returns {string}
 */
export function shortSuffix(length = 4) {
  const n = Math.max(1, length);
  const bytes = randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i += 1) {
    out += ALPHANUM[bytes[i] % ALPHANUM.length];
  }
  return out;
}
