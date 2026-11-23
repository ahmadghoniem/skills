---
description: Delegate a coding task, code sweep, or research pass to the opencode CLI.
argument-hint: '[--prompt-file <path>] [--model <id>] [--variant <level>] [--timeout <sec>] [--dir <path>] [--session <id>] [--continue] [--fork] <task...>'
allowed-tools: Bash(node:*), Bash(cat:*), Write
---

`$ARGUMENTS` is the raw text the user typed after `/opencode:delegate`.

## What opencode is for

Use opencode for well-specified, high-volume work that would otherwise consume
context better spent on judgement. Tokens land in opencode's context, so send the
task and let opencode inspect files rather than pre-reading the tree and pasting it in.

## The job name

This command prints one (`add-retry-to-fetchuser-a7f3`). `/opencode:result` takes it.

## Writing the brief

opencode has no conversation context. Everything the task depends on goes in the brief.
Write for a fast executor working from a contract, not a collaborator you can correct
mid-run. Do not pre-read the repo to write it: name the files and let opencode read them.

Every brief has these sections, in this order:

1. **Goal**: one or two sentences. What is the outcome, and what is it a step of.
2. **Repo context**: one or two lines. Stack, and which convention file to follow
   (`AGENTS.md`, `CLAUDE.md`) if the repo has one.
3. **Acceptance criteria**: one to five concrete, checkable bullets.
4. **Files to touch**: an explicit list. opencode must not wander outside it unless the
   task cannot predict the list.
5. **How to verify**: the exact command that proves the task is done. Without it opencode
   declares "done" on unverified work.

Then a short **Guardrails** block: do not commit; do not delete files outside the list; do
not rename public APIs unless asked; do not touch lockfiles unless the task is about
dependencies; if a pre-existing test already fails, report it, do not fix it.

Point at files rather than pasting them. A spec that already lives in the repo is a path
in the brief, not a copy.

One dispatch per coherent slice. Run at most three opencode jobs at once.

## The model

`opencode run` with no `--model` **does not fail** — it picks one of the configured
models itself, and that model may be metered. So this plugin will not dispatch without a
model drawn from an explicit allowlist, and `--model` must name something on it.

Omit `--model` and the default from the allowlist is used. Pass one only when the user
names it. Never invent an id.

Allowed right now:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/models.mjs" -- --allowed`

If that says nothing is allowed, stop and run `/opencode:models` — do not pick one
yourself, and do not work around the gate.

`--variant` is opencode's reasoning-effort knob (`minimal`, `low`, `medium`, `high`,
`max`, depending on the provider). Models that do not define variants ignore it.

## Run it

1. Write the brief with the **Write** tool to `~/.cod/briefs/<short-name>.md`. Never put
   a brief longer than one line on the command line.
2. Dispatch with the Bash tool, `run_in_background: true`, forward slashes in the path:

   node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- --prompt-file "C:/Users/<you>/.cod/briefs/<short-name>.md" [--model <id>] [--timeout <sec>]

   A one-line task can go inline instead: `-- "Rename X to Y in src/a.mjs"`.
3. Stop. The task notification arrives when opencode finishes. Do not read the job log,
   the task output file or `~/.cod/jobs` while it runs, and do not loop on
   `/opencode:result`. If the user asks how it is going, run `/opencode:result <job>` once.

| Flag | Effect |
| --- | --- |
| `--arg-string <blob>` | Treat `<blob>` as one unsplit argument string and split it here. Omit when argv is already tokenised. |
| `--prompt-file <path>` | Read the brief from this file instead of the command line. Not combined with an inline task. The file is attached to the run with opencode's `-f`, so nothing long ever travels through argv. |
| `--model <id>` | Pin an allowed `provider/model`. Omit to use the allowlist's default. |
| `--variant <level>` | Provider-specific reasoning effort. Ignored by models that define no variants. |
| `--timeout <sec>` | The watchdog. Default 3600 (60m). `opencode run` has no timeout of its own, so this is the only clock. |
| `--dir <path>` | Run against this directory instead of the repository root. The job record still lives with this repo. |
| `--session <id>` | Resume a specific opencode session (`ses_…`). Fresh dispatch is the default. |
| `--continue` | Resume opencode's most recent session. Machine-wide, so it may belong to another repository. Only when you pass it yourself; the plugin never falls back to it. |
| `--fork` | With `--session` or `--continue`, branch the session rather than continuing it. |

The plugin always passes `--auto`, opencode's approve-everything switch. There is nobody
to answer a permission prompt in a headless run, and the alternative blocks until the
watchdog kills it. Treat every dispatch as able to edit files and run commands.

## Reading the output

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/output-contract/contract.md"`

A non-zero exit from `delegate.mjs` means the run did not finish, not that opencode's work
is wrong. Read the ⚠ lines.

After a job that changed code, find out for yourself what changed and whether it works,
then run the verification command the brief gave. `git diff` on the files the brief named
is the usual route; reading the changed files is as good, and on a job whose output is not
a code change it is the only route. Pick whichever answers the question. Do not run the
repository's whole test suite over a slice. **Run the verification yourself**: opencode
reports a shell command that exited non-zero as a completed tool call, so a failing test
does not raise a ⚠ line and its report of success is not evidence. Find out what changed
before acting on a `/opencode:resume` line: resume only if the work is missing, and prefer
resume to a new dispatch.
