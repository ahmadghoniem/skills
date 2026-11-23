---
description: Delegate a coding task, code sweep, or research pass to the opencode CLI.
argument-hint: '[--prompt-file <path>] [--model <provider/model>] [--session <ses_id>] <task...>'
allowed-tools: Bash(node:*), Bash(cat:*), Write
---

`$ARGUMENTS` is the raw text the user typed after `/opencode:delegate`.

## What opencode is for

Use opencode for well-specified, high-volume work that would otherwise consume
context better spent on judgement, and to reach models the other delegates don't
have (DeepSeek, Kimi, GLM, Qwen through the user's providers). Tokens land in
opencode's context, so send the task and let opencode inspect files rather than
pre-reading the tree and pasting it in.

## Writing the brief

opencode starts with none of your context. It reads the repo's `AGENTS.md`. It does not
see this conversation, `~/.claude/CLAUDE.md` or `~/.claude/rules/`; whatever of that the
result depends on goes in the brief.

Write for a fast executor working from a contract, not a collaborator you can correct
mid-run. Every brief has these sections, in this order:

1. **Goal**: one or two sentences. What is the outcome, and what is it a step of.
2. **Repo context**: the stack, and what the paragraph above calls for.
3. **Acceptance criteria**: one to five concrete, checkable bullets.
4. **Files to touch**: every file you already know the task needs, as paths, plus the
   files that show the pattern to follow. Do not read the tree to complete the list.
5. **How to verify**: the exact command that proves the task is done.

Then a short **Guardrails** block: do not commit; do not delete files outside the list; do
not rename public APIs unless asked; do not touch lockfiles unless the task is about
dependencies; if a pre-existing test already fails, report it, do not fix it.

Do not ask for a list of changed files; you read the diff. Ask for what the diff cannot
show: what opencode was unsure about or skipped, problems it noticed but did not fix, the
result of each check.

## Model

Omit `--model`: the plugin uses `nebius/deepseek-ai/DeepSeek-V4.1-Flash-1017`. The plugin
always passes a model, because opencode with none picks one of its configured models on
its own, which may be metered. Pass `--model` only when the user names one; `opencode
models` lists the ids (`provider/model`, `#variant` for an effort level). Never invent one.

## Run it

1. Write the brief with the **Write** tool to `~/.cod/briefs/<short-name>.md`. Never put
   a brief longer than one line on the command line.
2. Dispatch with the Bash tool, `run_in_background: true`, forward slashes in the path:

   node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- --prompt-file "C:/Users/<you>/.cod/briefs/<short-name>.md" [--model <id>]

   A one-line task can go inline instead: `-- "Rename X to Y in src/a.mjs"`.
3. Stop. The task notification arrives when opencode finishes, with the whole output. To
   stop a run early, use TaskStop on its background task; that ends opencode's process tree too.

| Flag | Effect |
| --- | --- |
| `--prompt-file <path>` | Read the brief from this file. Not combined with an inline task. |
| `--model <id>` | A `provider/model` id from `opencode models`. |
| `--session <ses_id>` | Continue that session, with the id from a run's last line. A follow-up goes in the prompt. |

## Reading the output

!`cat "${CLAUDE_PLUGIN_ROOT}/contract.md"`

After a run that changed code, read `git diff` for the files the brief named and run the
verification command the brief gave.
