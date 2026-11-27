---
description: Convene grok, agy and opencode seats as a review council on a question, in rounds on frozen code, and bring back what they settled and what is yours to decide.
argument-hint: '[seats, e.g. grok agy opencode:] <question>'
allowed-tools: Bash(node:*), Bash(git:*), Read, Write, Grep, Glob, AskUserQuestion
---

`$ARGUMENTS` is the question, optionally led by the seats the user wants (`grok agy
opencode: review the auth change`). You are the chair. The members are other models
reviewing the same code; they work as a team that reads each other's answers, and you
keep the debate honest.

## 1. Seat the council

There are no standing seats. Seat exactly the agents the user named. If they named none,
propose seats with AskUserQuestion (multiSelect, one option per CLI with the model it
would run) and seat what they pick. Never add a seat they didn't ask for.

Write `~/.mngr/council/<short-name>/council.json`:

```json
{
  "seats": [
    { "name": "grok", "member": "grok" },
    { "name": "neon", "member": "agy" },
    { "name": "muse", "member": "opencode" },
    { "name": "auditor", "member": "agy", "model": "gemini-4-hydrogen-high", "auditor": true }
  ]
}
```

`member` is the CLI the seat runs on. Every seat runs an exact model, never an account
default: with no `model`, it gets its member's pinned seat model (grok `grok-4.7`, agy
`gemini-4-neon-high`, opencode `meta/muse-wonder-1.0#high`). Set `model` when the user names
another; `effort` is grok's only (agy and opencode carry effort in the model id). Every
seat gets the same question and the same brief: no roles, focus areas or per-seat
assignments, so each member decides for itself what matters. Seats marked `auditor` sit
out the rounds and read the settled result on frozen code.

**Seats don't see each other's model names.** The round script gives each seat a random
letter (Seat A, B, C …) and shows the others only that letter plus what the seat could
use, such as "read the repo; had web and X search". Set a seat's `access` in
`council.json` when it differs from its member's default, above all when a seat cannot read
the repo. In everything a seat reads (briefs, the dispute log, follow-ups) name seats by
letter only. You and the user see the real names: the round summary maps names to letters,
and your report uses real names.

Then show the user the roster, as-is, and wait for a go:

    node "${CLAUDE_PLUGIN_ROOT}/council/roster.mjs" -- --council <short-name>

It lists each seat's kind (core or auditor), exact model, effort, CLI version and quota
(what agy and grok have left; the last quota error for every seat). No cost estimate. Offer to swap
a seat whose model is blocked on quota or low. Once the user says go, record it:

    node "${CLAUDE_PLUGIN_ROOT}/council/roster.mjs" -- --council <short-name> --approve

`round.mjs` refuses round 1 until the roster is approved, and again if a seat or model
changed after that.

## 2. Write your own position first

Before any member answers, write your round-1 position to
`~/.mngr/council/<short-name>/chair.md`: your answer and why. You read the members only after
that, so their answers test yours instead of replacing it. `round.mjs` refuses round 1
until `chair.md` exists.

## 3. The brief

Write it to `~/.mngr/council/<short-name>/brief-1.md`. It holds:

- **The question**, and what a good answer lets the user do.
- **Facts**, with how each is known (file:line, command output), apart from **hypotheses**.
  Known or suspected issues go in as claims to check, not as settled: they may be
  overstated.
- **A file map**: the paths that matter and what each holds.
- **The user's hard rules** that bound the answer.
- **Scope**: what is out of it. Members put anything else under Out of scope.

The round script adds the seat's letter, the review-only rule and the final-answer block
format.

## 4. Run a round

Commit or stash first when you can: the round is stamped with the commit, and members
read the working tree as it is. Then, with the Bash tool and `run_in_background: true`:

    node "${CLAUDE_PLUGIN_ROOT}/council/round.mjs" -- --council <short-name> --brief "<path>" [--timeout-min 30]

Every core seat starts at once. The round ends when all have answered or at the timeout;
a seat still running then is stopped and marked MISSING. Do not edit the workspace while
a round runs (the summary flags any change, in a git repo or not), and do not wait idle: do other work, or stop
until the notification. Don't read the output files while it runs.

The output is each seat's status and its final-answer block; full outputs are in the
round folder it names.

## 5. Between rounds: the dispute log

Keep `~/.mngr/council/<short-name>/disputes.md`:

- **D1, D2 …** each a point the seats (or you) disagree on, under its own heading
  (`### D1: <the point> (OPEN)`) with every side's position and evidence below it. The
  heading ends **OPEN**, **CLOSED** (with what closed it in the text) or **PARKED**.
- **Parking lot**: everything from the Out of scope lines, and anything that grows the
  question. Fight scope creep: it does not go back in unless the user asks.

A position changes only for new evidence. A seat that flips because others disagreed,
with nothing new, stays at its old position in the log; say so. Weigh evidence, not
votes: models agreeing with each other is not evidence.

The next brief (`brief-2.md`) holds only the delta: the open disputes verbatim, new
evidence, and the questions each seat must answer. The script sends each seat the other
seats' final-answer blocks with it, on the same session; a seat that was MISSING gets the
first brief again.

## 6. Stop

Stop when positions stop moving, or after round 3 at the most. Then, if there are
auditors, freeze the code and run them alone (`--seats auditor`) on a brief holding the
settled answer and the closed disputes.

## 7. Report to the user

Write the report to `~/.mngr/council/<short-name>/report.md`:

- The answer the council settled on, with its evidence, and where you differ.
- **For your decision**: every OPEN dispute copied verbatim from the log, heading and all,
  each side with its evidence, as questions. Do not settle them yourself.
- The parking lot.
- Seats that were MISSING or failed, by name and model.

Then check it, fix whatever it names, and only then give the user the report:

    node "${CLAUDE_PLUGIN_ROOT}/council/check.mjs" -- --council <short-name>
