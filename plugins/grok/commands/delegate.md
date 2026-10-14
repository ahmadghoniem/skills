---
description: Delegate a coding task to the Grok Build CLI.
argument-hint: '[--prompt-file <path>] [--model <id>] [--effort low|medium] [--timeout <sec>] [--session <uuid>] <task...>'
allowed-tools: Bash(node:*), Bash(cat:*), Write
---

`$ARGUMENTS` is the raw text the user typed after `/grok:delegate`.

## What grok is for

Use grok for well-specified, high-volume work that would otherwise consume
context better spent on judgement. Tokens land in grok's context, so send the
task and let grok inspect files rather than pre-reading the tree and pasting it in.

## The job name

This command prints one (``grok `add-retry-to-fetchuser-a7f3` ``). `/grok:result`,
`/grok:resume` and `/grok:cancel` take it.

## Writing the brief

grok starts with none of your context. It does not see:

- this conversation
- the repo's `AGENTS.md` and `CLAUDE.md`, or `~/.claude/CLAUDE.md` and `~/.claude/rules/`
- any skill, hook, MCP server or plugin, yours or the repo's

Whatever of that the result depends on goes in the brief.

Write for a fast executor working from a contract, not a collaborator you can correct
mid-run.

Every brief has these sections, in this order:

1. **Goal**: one or two sentences. What is the outcome, and what is it a step of.
2. **Repo context**: the stack, and what the paragraph above calls for.
3. **Acceptance criteria**: one to five concrete, checkable bullets.
4. **Files to touch**: every file you already know the task needs, as paths, plus the
   files that show the pattern to follow. Each named path saves grok a search. Do not
   read the tree to complete the list; when you cannot predict it, say where to look and
   let grok find the rest.
5. **How to verify**: the exact command that proves the task is done. Without it grok
   declares "done" on unverified work.

Then a short **Guardrails** block: do not commit; do not delete files outside the list; do
not rename public APIs unless asked; do not touch lockfiles unless the task is about
dependencies; if a pre-existing test already fails, report it, do not fix it.

A spec that already lives in the repo is a path in the brief, not a copy.

Do not ask for a list of changed files or a summary of the edits; you read the diff.
Ask for what the diff cannot show: items grok was unsure about or skipped, problems it
noticed but did not fix, the result of each check, and any answer the task needs.

One dispatch per coherent slice. Run at most three grok jobs at once.

## Model and effort

Omit `--model`. grok then uses the account default that `grok models` reports, so a new
xAI model applies without a plugin change. Pass a model only when the user names one,
and never invent an id; `/grok:setup` lists the ones the account has.

`--effort` defaults to `medium`. Pass `--effort low` for mechanical work such as renames,
moves and boilerplate. The xAI plan this runs on allows only `low` and `medium`.

## Run it

1. Write the brief with the **Write** tool to `~/.cgd/briefs/<short-name>.md`. Never put
   a brief longer than one line on the command line.
2. Dispatch with the Bash tool, `run_in_background: true`, forward slashes in the path:

   node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- --prompt-file "C:/Users/<you>/.cgd/briefs/<short-name>.md" [--effort low] [--timeout <sec>]

   A one-line task can go inline instead: `-- --effort low "Rename X to Y in src/a.mjs"`.
   When `$ARGUMENTS` is still one unsplit string, pass it as `-- --arg-string "$ARGUMENTS"`
   so the plugin splits it and keeps its newlines.
3. Stop. The task notification arrives when grok finishes. Do not read the job log, the
   task output file or `~/.cgd/jobs` while it runs, and do not loop on `/grok:result`. If
   the user asks how it is going, run `/grok:result <job>` once.

| Flag | Effect |
| --- | --- |
| `--arg-string <blob>` | Treat `<blob>` as one unsplit argument string and split it here. Omit when argv is already tokenised. |
| `--prompt-file <path>` | Read the brief from this file instead of the command line. Not combined with an inline task. |
| `--model <id>` | Pin a model from `grok models`. Omit unless the user chose one. |
| `--effort <level>` | `low` or `medium`, passed to grok's `--reasoning-effort`. Defaults to `medium`. |
| `--timeout <sec>` | Watchdog. Default 4800, longer than grok's own 3600s idle timeout, so grok fails first and says why. |
| `--session <uuid>` | Continue that grok session. `/grok:resume` sets it from a job id; a fresh dispatch is the default. |

## Reading the output

!`cat "${CLAUDE_PLUGIN_ROOT}/contract.md"`

If grok's write-up says something blocked it (a missing tool, a refused command, an
instruction it could not follow), record it with
`/grok:papercut --text "<grok's words>" --job <id>`.

After a job that changed code, read `git diff` for the files the brief named and run the
verification command the brief gave. Do not run the repository's whole test suite over a
slice.
