---
description: Delegate a coding task, code sweep, or research pass to grok, agy, opencode or codex.
argument-hint: '<grok|agy|opencode|codex> <what to change, or what to find out>'
allowed-tools: Bash(node:*), Write, Read, AskUserQuestion
---

`$ARGUMENTS` is the raw text the user typed after `/mngr:delegate`. Its first word names
the CLI: `grok`, `agy`, `opencode` or `codex`. If it names none, ask which with AskUserQuestion
(one option per CLI) before anything else.

Then read `${CLAUDE_PLUGIN_ROOT}/clis/<cli>/delegate.md`: what that CLI is for, what it
reads, its models and its flags.

## Writing the brief

The CLI starts with none of your context: not this conversation, and only the files its
guide says it reads. Send the task and let it inspect files rather than pre-reading the
tree and pasting it in; tokens land in its context, not yours. Write for a fast executor
working from a contract, not a collaborator you can correct mid-run.

Every brief has these sections, in this order:

1. **Goal**: one or two sentences. What is the outcome, and what is it a step of.
2. **Repo context**: the stack, and what the task needs from files the CLI does not read.
3. **Acceptance criteria**: one to five concrete, checkable bullets.
4. **Files to touch**: every file you already know the task needs, as paths, plus the
   files that show the pattern to follow. Each named path saves the CLI a search. Do not
   read the tree to complete the list; when you cannot predict it, say where to look and
   let the CLI find the rest.
5. **How to verify**: the exact command that proves the task is done. Without it the CLI
   declares "done" on unverified work.

Then a short **Guardrails** block: do not commit; do not delete files outside the list; do
not rename public APIs unless asked; do not touch lockfiles unless the task is about
dependencies; if a pre-existing test already fails, report it, do not fix it.

A spec that already lives in the repo is a path in the brief, not a copy.

mngr ends every fresh brief with a note that nobody can answer questions during the run,
and that any question goes under "Open questions" at the end of the report. Do not add
your own.

Do not ask for a list of changed files or a summary of the edits; you read the diff.
Ask for what the diff cannot show: items it was unsure about or skipped, problems it
noticed but did not fix, the result of each check, and any answer the task needs.

One dispatch per coherent slice. Run at most three jobs on one CLI at once.

## Investigations

A job that changes nothing (counting, tracing, comparing, running a scratch script over
data) uses the same command. The brief states the questions to answer, where to look,
and the facts you need back, and says not to change the workspace; leave out Acceptance
criteria, Files to touch and Guardrails. Check a line the CLI cites before you edit it.

Send one only when you have other work to do while it runs: it takes minutes. Good ones
are long reads you would otherwise do yourself, such as a log, transcript or data file to
summarise, or a sweep across the repo (call sites, unused code, duplicated logic). Do not
send a lookup you can answer with a few searches, a file you are about to edit, or a
number you will have to verify anyway. Ask follow-ups on the same session or
conversation.

## Run it

1. Write the brief with the **Write** tool to `~/.mngr/<cli>/briefs/<short-name>.md`.
   Never put a brief longer than one line on the command line.
2. Dispatch with the Bash tool, `run_in_background: true`, forward slashes in the path:

   node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- <cli> --prompt-file "C:/Users/<you>/.mngr/<cli>/briefs/<short-name>.md" [flags]

   A one-line task can go inline instead: `-- <cli> "Rename X to Y in src/a.mjs"`.
   `--prompt-file` is not combined with an inline task.
3. Stop. The task notification arrives when the CLI finishes, with the whole output. To
   stop a run early, use TaskStop on its background task; that ends the CLI's process tree
   too.

## Reading the output

Read `${CLAUDE_PLUGIN_ROOT}/clis/<cli>/contract.md` before you act on the output: it
explains every `⚠` line. The first line names the model and session as the run starts;
a model the CLI does not list is refused before anything starts, with the close matches.

When the report ends with "Open questions", answer them yourself where you can, ask the
user the rest, and send the answers as a follow-up on the same session.

If the write-up says something blocked it (a missing tool, a refused command, an
instruction it could not follow), record it with
`/mngr:papercut <cli> --text "<its words>" --session <id>`.

After a job that changed code, read `git diff` for the files the brief named and run the
verification command the brief gave. Do not run the repository's whole test suite over a
slice.
