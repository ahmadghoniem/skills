import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** `~/.mngr/agy` (`MNGR_HOME` moves `~/.mngr`), or `MNGR_AGY_HOME`. Holds briefs, the papercut log and the release cache. */
export function pluginHome() {
  const fromEnv = process.env.MNGR_AGY_HOME?.trim();
  return fromEnv ? resolve(fromEnv) : join(process.env.MNGR_HOME?.trim() ? resolve(process.env.MNGR_HOME) : join(homedir(), '.mngr'), 'agy');
}

export const papercutsPath = () => join(pluginHome(), 'papercuts.jsonl');
export const releasePath = () => join(pluginHome(), 'agy-release.json');
export const quotaPath = () => join(pluginHome(), 'quota.json');
