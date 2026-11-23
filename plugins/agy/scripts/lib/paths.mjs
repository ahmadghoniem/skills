import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** `~/.cad`, or `CAD_HOME`. Holds briefs, the papercut log and the release cache. */
export function pluginHome() {
  const fromEnv = process.env.CAD_HOME?.trim();
  return fromEnv ? resolve(fromEnv) : join(homedir(), '.cad');
}

export const papercutsPath = () => join(pluginHome(), 'papercuts.jsonl');
export const releasePath = () => join(pluginHome(), 'agy-release.json');
export const quotaPath = () => join(pluginHome(), 'quota.json');
