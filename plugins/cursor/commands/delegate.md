---
description: Delegate a coding task to the Cursor CLI (cursor-agent).
argument-hint: '[--prompt-file <path>] [--model <id>] [--timeout <sec>] [--session <chatId>] <task...>'
allowed-tools: Bash(node:*), Bash(cat:*), Write
---

`$ARGUMENTS` is the raw text the user typed after `/cursor:delegate`.

## What Cursor is for

Use Cursor for well-specified, high-volume work that would otherwise consume
context better spent on judgement. Tokens land in Cursor's context, so send the
task and let Cursor inspect files rather than pre-reading the tree and pasting it in.

## The job name

This command prints one (``cursor `add-retry-to-fetchuser-a7f3` ``). `/cursor:result`,
`/cursor:resume` and `/cursor:cancel` take it.

## Writing the brief

Cursor starts with none of your context. It does not see:

- this conversation
- anything under your home folder: `~/.claude/CLAUDE.md`, `~/.claude/rules/`, your skills,
  hooks and Cursor skills. The plugin points Cursor's home folder at an empty one and
  keeps only your Cursor settings and git config.

It does load on its own, from the repo and every parent directory: `AGENTS.md`,
`CLAUDE.md`, `CLAUDE.local.md`, `.cursor/rules/`, the skills under `.cursor/`, `.claude/`
and `.agents/`, and the hooks in `.claude/settings.json`. Do not repeat those in the brief.

Whatever of the first list the result depends on goes in the brief.

Write for a fast executor working from a contract, not a collaborator you can correct
mid-run.

Every brief has these sections, in this order:

1. **Goal**: one or two sentences. What is the outcome, and what is it a step of.
2. **Repo context**: the stack, and what the paragraph above calls for.
3. **Acceptance criteria**: one to five concrete, checkable bullets.
4. **Files to touch**: every file you already know the task needs, as paths, plus the
   files that show the pattern to follow. Each named path saves Cursor a search. Do not
   read the tree to complete the list; when you cannot predict it, say where to look and
   let Cursor find the rest.
5. **How to verify**: the exact command that proves the task is done. Without it Cursor
   declares "done" on unverified work.

Then a short **Guardrails** block: do not commit; do not delete files outside the list; do
not rename public APIs unless asked; do not touch lockfiles unless the task is about
dependencies; if a pre-existing test already fails, report it, do not fix it.

A spec that already lives in the repo is a path in the brief, not a copy.

Do not ask for a list of changed files or a summary of the edits; you read the diff.
Ask for what the diff cannot show: items Cursor was unsure about or skipped, problems it
noticed but did not fix, the result of each check, and any answer the task needs.

One dispatch per coherent slice. Run at most three Cursor jobs at once.

## Model

Omit `--model`. The plugin then runs `grok-4.7-medium`, the only Grok 4.7 setting the Plus
plan allows. Pass a model only when the user names one, and
never invent an id; `/cursor:setup` lists the ones the account has. An id the plan does
not allow is refused, and the refusal arrives as the `⚠ error:` line.

## Run it

1. Write the brief with the **Write** tool to `~/.ccd/briefs/<short-name>.md`. Never put
   a brief longer than one line on the command line.
2. Dispatch with the Bash tool, `run_in_background: true`, forward slashes in the path:

   node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- --prompt-file "C:/Users/<you>/.ccd/briefs/<short-name>.md" [--timeout <sec>]

   A one-line task can go inline instead: `-- "Rename X to Y in src/a.mjs"`.
   When `$ARGUMENTS` is still one unsplit string, pass it as `-- --arg-string "$ARGUMENTS"`
   so the plugin splits it and keeps its newlines.
3. Stop. The task notification arrives when Cursor finishes. Do not read the job log, the
   task output file or `~/.ccd/jobs` while it runs, and do not loop on `/cursor:result`. If
   the user asks how it is going, run `/cursor:result <job>` once.

| Flag | Effect |
| --- | --- |
| `--arg-string <blob>` | Treat `<blob>` as one unsplit argument string and split it here. Omit when argv is already tokenised. |
| `--prompt-file <path>` | Read the brief from this file instead of the command line. Not combined with an inline task. |
| `--model <id>` | A model from `cursor-agent models`. Defaults to `grok-4.7-medium`. Omit unless the user chose one. |
| `--timeout <sec>` | Kill the run after this many seconds. Off by default. cursor-agent has no overall or idle limit of its own; it only retries or aborts a model stream that sends nothing for 30 s. |
| `--session <chatId>` | Continue that Cursor chat. `/cursor:resume` sets it from a job id; a fresh dispatch is the default. |

## Reading the output

!`cat "${CLAUDE_PLUGIN_ROOT}/contract.md"`

If Cursor's write-up says something blocked it (a missing tool, a refused command, an
instruction it could not follow), record it with
`/cursor:papercut --text "<Cursor's words>" --job <id>`.

After a job that changed code, read `git diff` for the files the brief named and run the
verification command the brief gave. Do not run the repository's whole test suite over a
slice.
