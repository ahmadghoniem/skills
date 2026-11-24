---
description: Convene grok, agy and opencode as a review council on a question, in rounds on frozen code, and bring back what they settled and what is yours to decide.
argument-hint: '<question>'
allowed-tools: Bash(node:*), Bash(git:*), Read, Write, Grep, Glob
---

`$ARGUMENTS` is the question. You are the chair. The members are other models reviewing
the same code; they work as a team that reads each other's answers, and you keep the
debate honest.

## 1. Seat the council

Write `~/.council/<short-name>/council.json`:

```json
{
  "seats": [
    { "name": "grok", "member": "grok", "effort": "medium" },
    { "name": "neon", "member": "agy", "model": "gemini-4-neon-high" },
    { "name": "muse", "member": "opencode", "model": "meta/muse-wonder-1.0" },
    { "name": "auditor", "member": "agy", "model": "gemini-4-hydrogen-high", "auditor": true }
  ]
}
```

`member` is the plugin the seat runs on; `model` and `effort` are optional (agy and
opencode carry effort in the model id). Every seat gets the same question and the same
brief: no roles, focus areas or per-seat assignments, so each member decides for itself
what matters. Seats marked `auditor` sit out the rounds and read the settled result on
frozen code.

The standing council is the three seats above: Grok, Neon and Muse Wonder. Muse Wonder
runs on opencode through its `meta` provider, so it reads the repo like the others. Swap
or add seats only when the user names them or a model is blocked on quota.

**Seats don't see each other's model names.** The round script gives each seat a random
letter (Seat A, B, C …) and shows the others only that letter plus what the seat could
use, such as "read the repo; had web and X search". Set a seat's `access` in
`council.json` when it differs from its member's default, above all when a seat cannot read
the repo. In everything a seat reads (briefs, the dispute log, follow-ups) name seats by
letter only. You and the user see the real names: the round summary maps names to letters,
and your report uses real names.

Then show the user the roster and wait for a go:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/roster.mjs" -- --council <short-name>

It lists each seat's kind (core or auditor), model, effort, CLI version and last quota error. No cost
estimate. Swap a seat whose model is blocked on quota before starting.

## 2. Write your own position first

Before any member answers, write your round-1 position to
`~/.council/<short-name>/chair.md`: your answer and why. You read the members only after
that, so their answers test yours instead of replacing it.

## 3. The brief

Write it to `~/.council/<short-name>/brief-1.md`. It holds:

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

    node "${CLAUDE_PLUGIN_ROOT}/scripts/round.mjs" -- --council <short-name> --brief "<path>" [--timeout-min 30]

Every core seat starts at once. The round ends when all have answered or at the timeout;
a seat still running then is stopped and marked MISSING. Do not edit the workspace while
a round runs (the summary flags any change), and do not wait idle: do other work, or stop
until the notification. Don't read the output files while it runs.

The output is each seat's status and its final-answer block; full outputs are in the
round folder it names.

## 5. Between rounds: the dispute log

Keep `~/.council/<short-name>/disputes.md`:

- **D1, D2 …** each a point the seats (or you) disagree on, with every side's position and
  evidence, marked **OPEN**, **CLOSED** (with what closed it) or **PARKED**.
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

- The answer the council settled on, with its evidence, and where you differ.
- **For your decision**: every OPEN dispute copied verbatim from the log, each side with
  its evidence, as questions. Do not settle them yourself.
- The parking lot.
- Seats that were MISSING or failed, by name and model.
