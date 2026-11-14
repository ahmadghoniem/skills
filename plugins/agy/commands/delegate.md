---
description: Delegate a coding task, code sweep, or research pass to the Antigravity CLI (agy).
argument-hint: '[--prompt-file <path>] [--model <id>] [--timeout <sec>] [--sandbox] [--conversation <uuid>] [--continue] <task...>'
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
2. **Repo context**: one or two lines of stack, and what the task needs from the repo's
   `CLAUDE.md`, which agy does not read. agy loads `AGENTS.md` and `GEMINI.md` itself, so
   do not repeat those.
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

## Investigations

A job that changes nothing (counting, tracing, comparing, running a scratch script over
data) uses the same command. The brief states the questions to answer, where to look,
and the facts you need back, and says not to change the workspace; leave out Acceptance
criteria, Files to touch and Guardrails. Check a line agy cites before you edit it.

Send one only when you have other work to do while it runs: it takes minutes. Good ones
are long reads you would otherwise do yourself, such as a log, transcript or data file to
summarise, or a sweep across the repo (call sites, unused code, duplicated logic). Do not
send a lookup you can answer with a few searches, a file you are about to edit, or a
number you will have to verify anyway. Ask follow-ups with `/agy:resume`.

## Model

Omit `--model`: the plugin uses `gemini-4-hydrogen-medium`. Pass `--model` with a full id
from the list below when the user names a model, or for work that needs more reasoning
(`gemini-4-hydrogen-high` or `-xhigh`, which take longer). The id carries the effort level.

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --print-models`

## Run it

1. Write the brief with the **Write** tool to `~/.cad/briefs/<short-name>.md`. Never put
   a brief longer than one line on the command line.
2. Dispatch with the Bash tool, `run_in_background: true`, forward slashes in the path:

   node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- --prompt-file "C:/Users/<you>/.cad/briefs/<short-name>.md" [--model <id>] [--timeout <sec>]

   A one-line task can go inline instead: `-- "Rename X to Y in src/a.mjs"`.
3. Stop. The task notification arrives when agy finishes. Do not read the job log, the
   task output file or `~/.cad/jobs` while it runs, and do not loop on `/agy:result`. If
   the user asks how it is going, run `/agy:result <job>` once.

| Flag | Effect |
| --- | --- |
| `--arg-string <blob>` | Treat `<blob>` as one unsplit argument string and split it here. Omit when argv is already tokenised. |
| `--prompt-file <path>` | Read the brief from this file instead of the command line. Not combined with an inline task. |
| `--model <id>` | A full id from the list above. Defaults to `gemini-4-hydrogen-medium`. |
| `--timeout <sec>` | Sets agy's `--print-timeout`. Omitted by default: the run goes until agy finishes. `/agy:cancel` stops it. |
| `--sandbox` | Restricts agy's own terminal commands only. |
| `--conversation <uuid>` | Resume a specific conversation. Fresh dispatch is the default. |
| `--continue` | Resume agy's most recent conversation in this workspace. Only when you pass it yourself; the plugin never falls back to it. |

## Reading the output

!`cat "${CLAUDE_PLUGIN_ROOT}/contract.md"`

After a job that changed code, read `git diff` for the files the brief named and run the
verification command the brief gave. Do not run the repository's whole test suite over a
slice.
