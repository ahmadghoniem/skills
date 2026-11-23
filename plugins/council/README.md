# council

Convene the delegate CLIs as a review council: [grok](../grok/README.md), [agy](../agy/README.md) and [opencode](../opencode/README.md) answer the same question, read each other's answers between rounds, and Claude chairs. What they settle comes back with its evidence; what they don't comes back to you as questions.

The council never starts a CLI itself. Each seat runs its member plugin's own `delegate.mjs`, so launching, error reading, papercuts and quota stay in that plugin. The members must be installed.

## Install

```bash
/plugin install council --marketplace ahmadghoniem/skills
```

Windows only. Install the member plugins (grok, agy, opencode) the same way.

## Commands

- **`/council:convene <question>`**: the protocol Claude follows: seat the council, show the roster, write a blind chair position, brief, run rounds, keep the dispute log, stop, and report.
- **`/council:roster [name]`**: each seat's role, model, effort, CLI version and last quota error.

## Scripts

- **`round.mjs --council <name> --brief <file> [--seats a,b] [--timeout-min 30] [--no-others]`** runs one round. Every chosen seat (all but the auditors by default) gets the brief at once, headed with the commit the code is frozen at, followed by the other seats' final-answer blocks from the last round and the answer rules. A seat continues its own session, so a later round sends only the delta; a seat with none (new, or MISSING last round) gets the first brief again. A seat still running at the timeout is stopped with its process tree and marked MISSING. The output is each seat's status and final-answer block, and a warning when the workspace changed during the round.
- **`roster.mjs [--council <name>]`** prints the roster. None of the CLIs reports remaining quota to a headless caller, so the roster shows the last quota error each plugin recorded for the seat's model, and whether it still blocks dispatch.

State lives in `~/.council/<name>/` (`COUNCIL_HOME`): `council.json` (seats and sessions) and `round-N/` (what each seat was sent, what it said, the summary).

`COUNCIL_<MEMBER>_DELEGATE` points a member at another `delegate.mjs`; otherwise the council finds the member next to it, in this repo or in Claude Code's plugin cache.

## Where the rules come from

The protocol keeps cross-reading as a team, which the research on councils (and the user) prefers over isolated parallel reviews, and guards against its known failure: models revising a right answer toward wrong peers (arXiv 2606.01637 measured harmful revisions going from 15.6% to 62.9% when all peers were wrong). Hence a blind chair position, positions that change only for new evidence, a dispute log, a round cap, and open disputes handed to the user rather than voted away.

`scripts/lib/shared/` is a copy of `plugins/_shared`; edit it there and run `node tools/sync-shared.mjs`.

## Licence

MIT.
