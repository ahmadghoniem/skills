---
description: Delegate a coding task, code sweep, or research pass to the Antigravity CLI (agy).
argument-hint: '[--prompt-file <path>] [--model <id>] [--effort <level>] [--timeout <sec>] [--sandbox] [--conversation <uuid>] [--continue] <task...>'
allowed-tools: Bash(node:*), Bash(cat:*), Write
---

`$ARGUMENTS` is the raw text the user typed after `/agy:delegate`.

## What agy is for

Use agy for well-specified, high-volume work that would otherwise consume
context better spent on judgement. Tokens land in agy's context, so send the
task and let agy inspect files rather than pre-reading the tree and pasting it in.

## The job name

This command prints one (`add-retry-to-fetchuser-a7f3`). `/agy:result` takes it.

## Writing the brief

agy has no conversation context. Everything the task depends on goes in the brief.
Write for a fast executor working from a contract, not a collaborator you can correct
mid-run. Do not pre-read the repo to write it: name the files and let agy read them.

Every brief has these sections, in this order:

1. **Goal**: one or two sentences. What is the outcome, and what is it a step of.
2. **Repo context**: one or two lines. Stack, and which convention file to follow
   (`AGENTS.md`, `CLAUDE.md`) if the repo has one.
3. **Acceptance criteria**: one to five concrete, checkable bullets.
4. **Files to touch**: an explicit list. agy must not wander outside it unless the task
   cannot predict the list.
5. **How to verify**: the exact command that proves the task is done. Without it agy
   declares "done" on unverified work.

Then a short **Guardrails** block: do not commit; do not delete files outside the list; do
not rename public APIs unless asked; do not touch lockfiles unless the task is about
dependencies; if a pre-existing test already fails, report it, do not fix it.

Point at files rather than pasting them. A spec that already lives in the repo is a path
in the brief, not a copy.

One dispatch per coherent slice. Run at most three agy jobs at once.

## Model and effort

Omit `--model`. The plugin picks the newest **flash** id from the cached `agy models`
list at the `--effort` you pass (`medium` if you pass none). Pass a model only when the
user names one. Never invent an id; the ids agy accepts are listed below.

## Run it

1. Write the brief with the **Write** tool to `~/.cad/briefs/<short-name>.md`. Never put
   a brief longer than one line on the command line.
2. Dispatch with the Bash tool, `run_in_background: true`, forward slashes in the path:

   node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- --prompt-file "C:/Users/<you>/.cad/briefs/<short-name>.md" [--effort <level>] [--timeout <sec>]

   A one-line task can go inline instead: `-- --effort low "Rename X to Y in src/a.mjs"`.
3. Stop. The task notification arrives when agy finishes. Do not read the job log, the
   task output file or `~/.cad/jobs` while it runs, and do not loop on `/agy:result`. If
   the user asks how it is going, run `/agy:result <job>` once.

| Flag | Effect |
| --- | --- |
| `--arg-string <blob>` | Treat `<blob>` as one unsplit argument string and split it here. Omit when argv is already tokenised. |
| `--prompt-file <path>` | Read the brief from this file instead of the command line. Not combined with an inline task. |
| `--model <id>` | Pin a model from `agy models`. Omit unless the user chose one; `--effort` then picks the id for you. |
| `--effort <level>` | `low`, `medium`, or `high`. Steers which flash id is picked. Defaults to `medium`. Ignored as a CLI arg when `--model` pins an id that already encodes effort — agy rejects the combination. |
| `--timeout <sec>` | Overrides `--print-timeout` and the outer watchdog. Default 900 (15m); the watchdog is that plus 60s grace. |
| `--sandbox` | Restricts terminal commands only. Not a read-only mode. |
| `--conversation <uuid>` | Resume a specific conversation. Fresh dispatch is the default. |
| `--continue` | Resume agy's most recent conversation. Machine-wide, so it may belong to another repository. Only when you pass it yourself; the plugin never falls back to it. |

## Reading the output

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/output-contract/contract.md"`

A non-zero exit from `delegate.mjs` means the run did not finish, not that agy's work is
wrong. Read the ⚠ lines. If a `/agy:resume` line is offered, resume rather than
re-dispatching.

After a job that changed code, read `git diff` for the files the brief named and run the
verification command the brief gave. Do not run the repository's whole test suite over a
slice.
