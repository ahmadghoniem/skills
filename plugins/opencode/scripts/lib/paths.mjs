import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function pluginHome() {
  const fromEnv = process.env.COD_HOME;
  if (fromEnv && fromEnv.trim().length > 0) return resolve(fromEnv);
  return join(homedir(), '.cod');
}

/**
 * Stable 12-hex-char SHA-256 prefix of the repo's canonical absolute path.
 * @param {string} repoRoot
 * @returns {string}
 */
export function repoHash(repoRoot) {
  // Canonicalise path via realpathSync; fall back to resolve if the path no longer exists.
  let canonical;
  try {
    canonical = realpathSync(repoRoot);
  } catch {
    canonical = resolve(repoRoot);
  }
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export function jobsDir(repoRoot) {
  return join(pluginHome(), 'jobs', repoHash(repoRoot));
}

/**
 * Machine-wide model list cache path.
 *
 * @returns {string}
 */
export function modelCachePath() {
  return join(pluginHome(), 'models.json');
}

/**
 * Plugin configuration: the model allowlist and the default model. Machine-wide,
 * not per repository — the set of models you are allowed to spend on is a
 * property of your accounts, not of the checkout you happen to be in.
 *
 * @returns {string}
 */
export function configPath() {
  return join(pluginHome(), 'config.json');
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}
