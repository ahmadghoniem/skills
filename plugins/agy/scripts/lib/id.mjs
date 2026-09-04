import { randomBytes } from 'node:crypto';

const ALPHANUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Lowercase alphanumeric suffix for job names (`a7f3`).
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
