import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** `~/.mngr/grok` (`MNGR_HOME` moves `~/.mngr`), or `MNGR_GROK_HOME`. Holds briefs, the papercut log and the release cache. */
export function pluginHome() {
  const fromEnv = process.env.MNGR_GROK_HOME?.trim();
  return fromEnv ? resolve(fromEnv) : join(process.env.MNGR_HOME?.trim() ? resolve(process.env.MNGR_HOME) : join(homedir(), '.mngr'), 'grok');
}

export const papercutsPath = () => join(pluginHome(), 'papercuts.jsonl');
export const releasePath = () => join(pluginHome(), 'grok-release.json');
export const quotaPath = () => join(pluginHome(), 'quota.json');
