# council

Part of [mngr](../README.md). Convene the CLIs as a review council: seats on [grok](../clis/grok/README.md), [agy](../clis/agy/README.md), [opencode](../clis/opencode/README.md) and [codex](../clis/codex/README.md) answer the same question, read each other's answers between rounds, and Claude chairs. What they settle comes back with its evidence; what they don't comes back to you as questions.

The council never starts a CLI itself. Each seat runs mngr's own `clis/<cli>/scripts/delegate.mjs`, so launching, error reading, papercuts and quota stay there.

## Command

- **`/mngr:council [seats:] <question>`**: the protocol Claude follows: seat the agents you name (or propose some for you to pick), show the roster and wait for your go, write a blind chair position, brief, run rounds, keep the dispute log, stop, and report.

There are no standing seats. Every seat runs an exact model, never an account default: its own `model`, or its CLI's pinned seat model (grok `grok-4.7`, agy `gemini-4-neon-high`, opencode `meta/muse-wonder-1.0#high`, codex `gpt-6.2-astra` at `low`).

## Scripts

- **`round.mjs --council <name> --brief <file> [--seats a,b] [--timeout-min 30] [--no-others]`** runs one round. Every chosen seat (all but the auditors by default) gets the brief at once, headed with the commit the code is frozen at, followed by the other seats' final-answer blocks from the last round and the answer rules. A seat continues its own session, so a later round sends only the delta; a seat with none (new, or MISSING last round) gets the first brief again. A seat still running at the timeout is stopped with its process tree and marked MISSING. The output is each seat's status and final-answer block, and a warning when the workspace changed during the round: in a git repo a moved commit or any uncommitted file that changed, even one already uncommitted; outside git any file whose size or modified time changed (folders over 20,000 files aren't watched, and the summary says so). Round 1 refuses to start until the user has approved the roster (`roster.mjs --approve`; a seat or model changed afterwards needs approving again) and the chair has written `chair.md`. `council.json` is saved as each seat finishes, so a stopped round keeps the sessions it got.
- **`check.mjs --council <name>`** checks the chair's `report.md` before it goes to the user: every OPEN dispute in `disputes.md` (a `### D<n> … OPEN` heading and what's under it) must appear in it word for word. Exits 1 and names the missing ones otherwise.
- **`roster.mjs --council <name> [--approve]`** prints the roster: each seat's kind, exact model, effort, CLI version and quota. For agy seats it shows what is left (`agy -p /usage --output-format json`, which spends no tokens), and for grok seats the week's credit left (the billing endpoint grok's app reads, with grok's own sign-in; Grok chat draws on the same credit); for every seat, the last quota error mngr recorded for its model and whether it still blocks dispatch. `--approve` records the roster the user said go to.

State lives in `~/.mngr/council/<name>/` (`COUNCIL_HOME`): `council.json` (seats, sessions, the approved roster), the chair's `chair.md`, `disputes.md` and `report.md`, and `round-N/` (what each seat was sent, what it said, the summary).

`COUNCIL_<MEMBER>_DELEGATE` points a member at another `delegate.mjs` (the tests use it).

## Where the rules come from

The protocol keeps cross-reading as a team, which the research on councils (and the user) prefers over isolated parallel reviews, and guards against its known failure: models revising a right answer toward wrong peers (arXiv 2606.01637 measured harmful revisions going from 15.6% to 62.9% when all peers were wrong). Hence a blind chair position, positions that change only for new evidence, a dispute log, a round cap, and open disputes handed to the user rather than voted away.

## Licence

MIT.
