---
description: Delegate a coding task to the Grok Build CLI.
argument-hint: '[--fresh] [--resume[=session-id]] [--model <id>] [--effort <level>] [--timeout <sec>] [--no-git-check] [--prompt-file <path|->] <task...>'
allowed-tools: Bash(node:*), AskUserQuestion
---

`$ARGUMENTS` is the raw text the user typed after `/grok:delegate`.

## Two entrypoints, one job registry

`/grok:delegate` starts a job; `/grok:result [job-id]` inspects it afterwards. Both share the same file-backed job record (`~/.cgd/jobs/<repo-hash>/<id>.json`), keyed by the **Grok job id** this command prints — not any wrapper id a background-execution mechanism might report. Copy that id verbatim for follow-up commands.

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

Do **not** pass the plugin's own `--background`. It detaches the worker, which
severs the harness notification and leaves polling as the only way to find out the
job is done. It exists for scripting, not for you.

| Flag | Effect |
| --- | --- |
| `--arg-string <blob>` | Treat `<blob>` as one unsplit argument string and split it here. Omit it when argv is already tokenised. |
| `--model <id>` | Pin a model. Omit it and the plugin uses the newest model `grok models` reports. |
| `--effort <level>` | Grok's `--reasoning-effort`. Pick per task: low for mechanical work, higher when the task needs thinking. |
| `--background` | Detach the worker. Scripting only — it severs the harness notification, which is what forces polling. |
| `--resume[=<id>]` | Continue a grok session — the most recent for this directory, or a specific one. Send only the delta, not the whole task again. |
| `--fresh` | Start a new session even if a recent one exists. |
| `--timeout <sec>` | Watchdog. Default 3600 (an hour) — grok bills per run, so a stuck run is worth killing. |
| `--prompt-file <path\|->` | Read the brief from a file, or `-` for stdin. Use this for anything long or quote-heavy. |
| `--no-git-check` | Allow dispatching outside a git repository. |

## Reading the output

The output is grok's own write-up, and on a clean run that is all of it. Relay it
without a status table, a file list, or timings of your own — you have `git
status` and `git diff` if you want to know what changed, and running them is
cheaper than making the user read a summary of them.

Lines starting `⚠` are the exceptions the plugin does surface. Never drop one, and
never fold two into one verdict:

- `⚠ stop reason: …` is grok's own verdict; `⚠ exit N` is the process exit code.
  They are independent and disagree in both directions.
- `⚠ N commands exited non-zero` lists terminal commands that failed. It does
  **not** mean the job failed — a `grep` that matches nothing, or a deliberately
  red test, exits non-zero on purpose. Surface it and let the user judge.

After a job that changed code, review the diff yourself before telling the user it
is done.
