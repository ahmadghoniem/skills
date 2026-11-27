import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** `~/.mngr/codex` (`MNGR_HOME` moves `~/.mngr`), or `MNGR_CODEX_HOME`. Holds briefs, the papercut log and the release cache. */
export function pluginHome() {
  const fromEnv = process.env.MNGR_CODEX_HOME?.trim();
  return fromEnv ? resolve(fromEnv) : join(process.env.MNGR_HOME?.trim() ? resolve(process.env.MNGR_HOME) : join(homedir(), '.mngr'), 'codex');
}

export const papercutsPath = () => join(pluginHome(), 'papercuts.jsonl');
export const releasePath = () => join(pluginHome(), 'codex-release.json');
export const quotaPath = () => join(pluginHome(), 'quota.json');

/** Codex's own folder: `CODEX_HOME`, or `~/.codex`. */
export const codexHome = () => (process.env.CODEX_HOME?.trim() ? resolve(process.env.CODEX_HOME) : join(homedir(), '.codex'));
