import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** `~/.mngr/opencode` (`MNGR_HOME` moves `~/.mngr`), or `MNGR_OPENCODE_HOME`. Holds briefs, the papercut log and the release cache. */
export function pluginHome() {
  const fromEnv = process.env.MNGR_OPENCODE_HOME?.trim();
  return fromEnv ? resolve(fromEnv) : join(process.env.MNGR_HOME?.trim() ? resolve(process.env.MNGR_HOME) : join(homedir(), '.mngr'), 'opencode');
}

export const papercutsPath = () => join(pluginHome(), 'papercuts.jsonl');
export const releasePath = () => join(pluginHome(), 'opencode-release.json');
export const quotaPath = () => join(pluginHome(), 'quota.json');
