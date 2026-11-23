import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** `~/.cgd`, or `CGD_HOME`. Holds briefs, the papercut log and the release cache. */
export function pluginHome() {
  const fromEnv = process.env.CGD_HOME?.trim();
  return fromEnv ? resolve(fromEnv) : join(homedir(), '.cgd');
}

export const papercutsPath = () => join(pluginHome(), 'papercuts.jsonl');
export const releasePath = () => join(pluginHome(), 'grok-release.json');
export const quotaPath = () => join(pluginHome(), 'quota.json');
