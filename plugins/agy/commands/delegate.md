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
mid-run.

Every brief has these sections, in this order:

1. **Goal**: one or two sentences. What is the outcome, and what is it a step of.
2. **Repo context**: one or two lines of stack. The plugin already sends agy the repo's
   `AGENTS.md` (or `CLAUDE.md`), so do not repeat or point to it.
3. **Acceptance criteria**: one to five concrete, checkable bullets.
4. **Files to touch**: every file you already know the task needs, as paths, plus the
   files that show the pattern to follow. Each named path saves agy a search. Do not
   read the tree to complete the list; when you cannot predict it, say where to look and
   let agy find the rest.
5. **How to verify**: the exact command that proves the task is done. Without it agy
   declares "done" on unverified work.

Then a short **Guardrails** block: do not commit; do not delete files outside the list; do
not rename public APIs unless asked; do not touch lockfiles unless the task is about
dependencies; if a pre-existing test already fails, report it, do not fix it.

A spec that already lives in the repo is a path in the brief, not a copy.

Do not ask for a list of changed files or a summary of the edits; you read the diff.
Ask for what the diff cannot show: items agy was unsure about or skipped, problems it
noticed but did not fix, the result of each check, and any answer the task needs.

One dispatch per coherent slice. Run at most three agy jobs at once.

## Model and effort

Omit `--model`. The plugin uses `gemini-3.7-flash` at the `--effort` you pass (`medium`
if you pass none). Pass `--effort low` for mechanical edits and `--effort high` for work
that needs more reasoning. Pass a model only when the user names one. Never invent an
id; the ids agy accepts are listed below.

Models agy accepts right now (family, then the effort levels it takes):

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --print-models`

Pass `--model <family> --effort <level>`, or a full id from that list with no `--effort`. agy rejects a level the model does not have, and its error names the ones it has.

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
| `--effort <level>` | `low`, `medium`, or `high`. Picks the `gemini-3.7-flash` id at that level. Defaults to `medium`. Ignored as a CLI arg when `--model` pins an id that already encodes effort — agy rejects the combination. |
| `--timeout <sec>` | Overrides `--print-timeout` and the outer watchdog. Default 3600 (60m); the watchdog is that plus 60s grace. |
| `--sandbox` | Restricts agy's own terminal commands only. |
| `--conversation <uuid>` | Resume a specific conversation. Fresh dispatch is the default. |
| `--continue` | Resume agy's most recent conversation in this workspace. Only when you pass it yourself; the plugin never falls back to it. |

## Reading the output

!`cat "${CLAUDE_PLUGIN_ROOT}/contract.md"`

After a job that changed code, read `git diff` for the files the brief named and run the
verification command the brief gave. Do not run the repository's whole test suite over a
slice.
