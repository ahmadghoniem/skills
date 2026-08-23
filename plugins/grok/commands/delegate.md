---
description: Delegate a coding task to the Grok Build CLI.
argument-hint: '[--background] [--wait] [--fresh] [--resume[=session-id]] [--model <id>] [--effort <level>] [--timeout <sec>] [--no-git-check] [--prompt-file <path|->] <task...>'
allowed-tools: Bash(node:*), AskUserQuestion
---

`$ARGUMENTS` is the raw text the user typed after `/grok:delegate`.

## Two entrypoints, one job registry

`/grok:delegate` starts a job; `/grok:result [job-id]` inspects it afterwards. Both share the same file-backed job record (`~/.cgd/jobs/<repo-hash>/<id>.json`), keyed by the **Grok job id** this command prints — not any wrapper id a background-execution mechanism might report. Copy that id verbatim for follow-up commands.

## Run it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- [flags] "<task>"
```

Flags go **before** the task, and the task is a single quoted argument. Never place a flag after the task text and never split the task across arguments.

| Flag | Effect |
| --- | --- |
| `--model <id>` | Pin a model. Omit it and the plugin uses the newest model `grok models` reports. |
| `--effort <level>` | Grok's `--reasoning-effort`. Pick per task: low for mechanical work, higher when the task needs thinking. |
| `--background` | Return immediately; fetch the write-up later with `/grok:result <id>`. Default is to block and print the result inline. |
| `--wait` | Force the foreground even if `--background` was also passed. |
| `--resume[=<id>]` | Continue a grok session — the most recent for this directory, or a specific one. Send only the delta, not the whole task again. |
| `--fresh` | Start a new session even if a recent one exists. |
| `--timeout <sec>` | Watchdog. Default 3600 (an hour) — grok bills per run, so a stuck run is worth killing. |
| `--prompt-file <path\|->` | Read the brief from a file, or `-` for stdin. Use this for anything long or quote-heavy. |
| `--no-git-check` | Allow dispatching outside a git repository. |

## Reading the output

Show the result block to the user as-is. Two parts deserve attention rather than paraphrase:

- **`⚠ Commands that exited non-zero`** — grok's stream reports an exit code for every terminal command it ran. This section lists the ones that failed. It does **not** mean the job failed: a `grep` that matches nothing, or a deliberately red test, exits non-zero on purpose. Surface it and let the user judge.
- **`Cost`** — grok reports real spend per run. Worth mentioning when it is unusually high.

The run's status comes from grok's own stop reason, not from those exit codes.
