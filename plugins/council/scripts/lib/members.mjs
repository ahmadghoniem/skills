// The delegate plugins a council seat can run on, and how to reach each one.
// The council never talks to a CLI itself: it runs the member plugin's own
// delegate.mjs, so launching, error reading, papercuts and quota stay there.

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions } from './shared/release.mjs';

const home = (envName, dir) => () => (process.env[envName]?.trim() ? resolve(process.env[envName]) : join(homedir(), dir));

/**
 * `continueFlag` continues a session; `idLine` reads its id off the run's last
 * line. `defaultModel` is what the plugin uses when a seat names none.
 */
export const MEMBERS = Object.freeze({
  grok: { cli: 'grok', continueFlag: '--session', idLine: /^session: (\S+)\s*$/gm, home: home('CGD_HOME', '.cgd'), defaultModel: 'the account default', efforts: ['low', 'medium'] },
  agy: { cli: 'agy', continueFlag: '--conversation', idLine: /^conversation: (\S+)\s*$/gm, home: home('CAD_HOME', '.cad'), defaultModel: 'gemini-4-hydrogen-medium', efforts: [] },
  opencode: { cli: 'opencode', continueFlag: '--session', idLine: /^session: (\S+)\s*$/gm, home: home('COD_HOME', '.cod'), defaultModel: 'nebius/deepseek-ai/DeepSeek-V4.1-Flash-1017', efforts: [] },
});

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The member plugin's delegate.mjs, or null. `COUNCIL_<MEMBER>_DELEGATE`
 * overrides; otherwise the sibling folder in this repo (`plugins/<member>`), or
 * the newest installed version next to this plugin in Claude Code's cache
 * (`cache/<marketplace>/<member>/<version>`).
 */
export function delegatePath(member) {
  const override = process.env[`COUNCIL_${member.toUpperCase()}_DELEGATE`]?.trim();
  if (override) return existsSync(override) ? override : null;
  const sibling = join(PLUGIN_ROOT, '..', member, 'scripts', 'delegate.mjs');
  if (existsSync(sibling)) return sibling;
  const cached = join(PLUGIN_ROOT, '..', '..', member);
  try {
    const versions = readdirSync(cached).sort(compareVersions).reverse();
    for (const v of versions) {
      const p = join(cached, v, 'scripts', 'delegate.mjs');
      if (existsSync(p)) return p;
    }
  } catch {
    // not installed
  }
  return null;
}

/** The id on the run's last `session:`/`conversation:` line, or null. */
export function sessionFrom(member, stdout) {
  const all = [...String(stdout).matchAll(MEMBERS[member].idLine)];
  return all.length ? all.at(-1)[1] : null;
}

/** delegate.mjs's argv for one seat. */
export function seatArgs(seat, promptFile) {
  const m = MEMBERS[seat.member];
  const args = ['--prompt-file', promptFile];
  if (seat.model) args.push('--model', seat.model);
  if (seat.effort && m.efforts.length) args.push('--effort', seat.effort);
  if (seat.session) args.push(m.continueFlag, seat.session);
  return args;
}
