// The CLIs a council seat can run on, and how to reach each one. The council
// never talks to a CLI itself: it runs mngr's own delegate.mjs for that CLI, so
// launching, error reading, papercuts and quota stay there.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Where mngr keeps a CLI's papercuts and quota record: `~/.mngr/<cli>`, as mngr's own `paths.mjs` has it. */
const home = (cli) => () => {
  const own = process.env[`MNGR_${cli.toUpperCase()}_HOME`]?.trim();
  if (own) return resolve(own);
  return join(process.env.MNGR_HOME?.trim() ? resolve(process.env.MNGR_HOME) : join(homedir(), '.mngr'), cli);
};

/**
 * `continueFlag` continues a session; `idLine` reads its id off the run's last
 * line. `seatModel` is the exact model a seat runs when council.json names
 * none: always passed, never the account default, so a seat can't quietly
 * change model. `access` is what the other seats are told this seat could
 * use; a seat's own `access` overrides it.
 */
export const MEMBERS = Object.freeze({
  grok: { cli: 'grok', continueFlag: '--session', idLine: /^session: (\S+)\s*$/gm, home: home('grok'), seatModel: 'grok-4.7', efforts: ['low', 'medium'], access: 'read the repo; had web and X search' },
  agy: { cli: 'agy', continueFlag: '--conversation', idLine: /^conversation: (\S+)\s*$/gm, home: home('agy'), seatModel: 'gemini-4-neon-high', efforts: [], access: 'read the repo; had web search' },
  opencode: { cli: 'opencode', continueFlag: '--session', idLine: /^session: (\S+)\s*$/gm, home: home('opencode'), seatModel: 'meta/muse-wonder-1.0#high', efforts: [], access: 'read the repo; had web search' },
  codex: {
    cli: codexCli(),
    continueFlag: '--session',
    idLine: /^session: (\S+)\s*$/gm,
    home: home('codex'),
    seatModel: 'gpt-6.2-astra',
    // The provider's default for Astra, written out so a change in Codex's own default can't move it.
    seatEffort: 'low',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    access: 'read the repo; had web search',
  },
});

/** The standalone codex.exe when installed, else `codex` on PATH. */
function codexCli() {
  const standalone = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
  return existsSync(standalone) ? standalone : 'codex';
}

/** The effort a seat runs at: its own, or its member's pinned one. Null where the model id carries it. */
export const seatEffortOf = (seat) => (MEMBERS[seat.member]?.efforts.length ? seat.effort ?? MEMBERS[seat.member].seatEffort ?? null : null);

/** The model a seat runs: its own, or its member's pinned seat model. */
export const modelOf = (seat) => seat.model ?? MEMBERS[seat.member]?.seatModel;

/** What the other seats are told this seat could use. */
export const accessOf = (seat) => seat.access ?? MEMBERS[seat.member].access;

const MNGR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** mngr's delegate.mjs for the member's CLI, or null. `COUNCIL_<MEMBER>_DELEGATE` overrides (the tests set it). */
export function delegatePath(member) {
  const override = process.env[`COUNCIL_${member.toUpperCase()}_DELEGATE`]?.trim();
  const path = override || join(MNGR_ROOT, 'clis', member, 'scripts', 'delegate.mjs');
  return existsSync(path) ? path : null;
}

/** The id on the run's last `session:`/`conversation:` line, or null. */
export function sessionFrom(member, stdout) {
  const all = [...String(stdout).matchAll(MEMBERS[member].idLine)];
  return all.length ? all.at(-1)[1] : null;
}

/** delegate.mjs's argv for one seat. */
export function seatArgs(seat, promptFile) {
  const m = MEMBERS[seat.member];
  const args = ['--prompt-file', promptFile, '--model', modelOf(seat)];
  const effort = seatEffortOf(seat);
  if (effort) args.push('--effort', effort);
  if (seat.session) args.push(m.continueFlag, seat.session);
  return args;
}
