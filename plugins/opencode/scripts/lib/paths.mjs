import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** `~/.cod`, or `COD_HOME`. Holds briefs, the papercut log and the release cache. */
export function pluginHome() {
  const fromEnv = process.env.COD_HOME?.trim();
  return fromEnv ? resolve(fromEnv) : join(homedir(), '.cod');
}

export const papercutsPath = () => join(pluginHome(), 'papercuts.jsonl');
export const releasePath = () => join(pluginHome(), 'opencode-release.json');
export const quotaPath = () => join(pluginHome(), 'quota.json');
