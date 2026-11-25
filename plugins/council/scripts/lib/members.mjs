// The delegate plugins a council seat can run on, and how to reach each one.
// The council never talks to a CLI itself: it runs the member plugin's own
// delegate.mjs, so launching, error reading, papercuts and quota stay there.

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions } from './shared/release.mjs';

/** Where mngr keeps a CLI's papercuts and quota record: `~/.mngr/<cli>`, as mngr's own `paths.mjs` has it. */
const home = (cli) => () => {
  const own = process.env[`MNGR_${cli.toUpperCase()}_HOME`]?.trim();
  if (own) return resolve(own);
  return join(process.env.MNGR_HOME?.trim() ? resolve(process.env.MNGR_HOME) : join(homedir(), '.mngr'), cli);
};

/**
 * `continueFlag` continues a session; `idLine` reads its id off the run's last
 * line. `defaultModel` is what the plugin uses when a seat names none. `access`
 * is what the other seats are told this seat could use; a seat's own `access`
 * overrides it.
 */
export const MEMBERS = Object.freeze({
  grok: { cli: 'grok', continueFlag: '--session', idLine: /^session: (\S+)\s*$/gm, home: home('grok'), defaultModel: 'the account default', efforts: ['low', 'medium'], access: 'read the repo; had web and X search' },
  agy: { cli: 'agy', continueFlag: '--conversation', idLine: /^conversation: (\S+)\s*$/gm, home: home('agy'), defaultModel: 'gemini-4-hydrogen-medium', efforts: [], access: 'read the repo; had web search' },
  opencode: { cli: 'opencode', continueFlag: '--session', idLine: /^session: (\S+)\s*$/gm, home: home('opencode'), defaultModel: 'nebius/deepseek-ai/DeepSeek-V4.1-Flash-1017', efforts: [], access: 'read the repo; had web search' },
});

/** What the other seats are told this seat could use. */
export const accessOf = (seat) => seat.access ?? MEMBERS[seat.member].access;

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The member's delegate.mjs inside the mngr plugin, or null.
 * `COUNCIL_<MEMBER>_DELEGATE` overrides; otherwise mngr next to this plugin in
 * this repo (`plugins/mngr`), or the newest installed mngr in Claude Code's
 * cache (`cache/<marketplace>/mngr/<version>`).
 */
export function delegatePath(member) {
  const override = process.env[`COUNCIL_${member.toUpperCase()}_DELEGATE`]?.trim();
  if (override) return existsSync(override) ? override : null;
  const inMngr = (root) => join(root, 'clis', member, 'scripts', 'delegate.mjs');
  const sibling = inMngr(join(PLUGIN_ROOT, '..', 'mngr'));
  if (existsSync(sibling)) return sibling;
  const cached = join(PLUGIN_ROOT, '..', '..', 'mngr');
  try {
    const versions = readdirSync(cached).sort(compareVersions).reverse();
    for (const v of versions) {
      const p = inMngr(join(cached, v));
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
