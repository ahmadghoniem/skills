---
description: Delegate a coding task to the Grok Build CLI.
argument-hint: '[--fresh] [--resume=<job-id|session-uuid>] [--model <id>] [--effort <level>] [--timeout <sec>] [--no-git-check] [--prompt-file <path|->] <task...>'
allowed-tools: Bash(node:*), AskUserQuestion, Bash(cat:*)
---

`$ARGUMENTS` is the raw text the user typed after `/grok:delegate`.

## The job id

Copy the **Grok job id** this command prints — not the wrapper id a background-execution mechanism might report. `/grok:result` takes it.

## Run it — always backgrounded

Invoke with the **Bash tool's `run_in_background: true`**. The command itself runs
grok in the foreground of its own process, so the harness sees the exit and tells
you when it lands. The user keeps chatting with you the whole time, and you never
poll for completion.

When `$ARGUMENTS` is still one unsplit string (the slash-command case), pass it with `--arg-string` so the plugin splits it and newlines are not flattened:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- --arg-string "$ARGUMENTS"
```

When the shell has already split the command line, omit `--arg-string` — argv is used as-is after a leading `--`. Flags go **before** the task, and the task is a single quoted argument.

| Flag | Effect |
| --- | --- |
| `--arg-string <blob>` | Treat `<blob>` as one unsplit argument string and split it here. Omit it when argv is already tokenised. |
| `--model <id>` | Pin a model. Omit it and the plugin uses the newest model `grok models` reports. |
| `--effort <level>` | Grok's `--reasoning-effort`. Pick per task. |
| `--resume=<id>` | Continue a specific grok session. `<id>` is either the **job id** printed when that run was dispatched, or a grok **session uuid** (what the resume hint prints after a kill). A bare `--resume` is refused — jobs from every Claude session in this directory share one store, so "the most recent" is not reliably yours. Send only the delta, not the whole task again. |
| `--fresh` | Start a new session even if a recent one exists. |
| `--timeout <sec>` | Watchdog. Default 4800 — deliberately longer than grok's own 3600s idle timeout, so grok fails first and says why. |
| `--prompt-file <path\|->` | Read the brief from a file, or `-` for stdin. Use this for anything long or quote-heavy. |
| `--no-git-check` | Allow dispatching outside a git repository. |

## Reading the output

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/output-contract/contract.md"`

After a job that changed code, review the diff yourself before telling the user it
is done.
