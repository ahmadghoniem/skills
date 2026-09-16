---
description: Delegate a coding task, code sweep, or research pass to the Antigravity CLI (agy).
argument-hint: '[--model <id>] [--effort <level>] [--timeout <sec>] [--sandbox] [--conversation <uuid>] [--continue] <task...>'
allowed-tools: Bash(node:*), Bash(cat:*)
---

`$ARGUMENTS` is the raw text the user typed after `/agy:delegate`.

## What agy is for

Use agy for well-specified, high-volume work that would otherwise consume
context better spent on judgement. Tokens land in agy's context, so send the
task and let agy inspect files rather than pre-reading the tree and pasting it in.

## The job name

This command prints one (`add-retry-to-fetchuser-a7f3`). `/agy:result` takes it.

## Model and effort

Omit `--model`. The plugin picks the newest **flash** id from the cached `agy models`
list at the `--effort` you pass (`medium` if you pass none). Pass a model only when the
user names one. Never invent an id; the ids agy accepts are listed below.

## Run it — always backgrounded

Invoke with the **Bash tool's `run_in_background: true`**. The command runs
agy in its own process; the harness reports the exit when finished without polling.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- --arg-string "$ARGUMENTS"
```

Use `--arg-string` when `$ARGUMENTS` is still one unsplit string (the
slash-command case) so the plugin splits it and newlines survive. When the shell
has already tokenised argv, drop `--arg-string` and pass argv after a leading
`--`; flags go **before** the task, and the task is one quoted argument.

| Flag | Effect |
| --- | --- |
| `--arg-string <blob>` | Treat `<blob>` as one unsplit argument string and split it here. Omit when argv is already tokenised. |
| `--model <id>` | Pin a model from `agy models`. Omit unless the user chose one; `--effort` then picks the id for you. |
| `--effort <level>` | `low`, `medium`, or `high`. Steers which flash id is picked. Defaults to `medium`. Ignored as a CLI arg when `--model` pins an id that already encodes effort — agy rejects the combination. |
| `--timeout <sec>` | Overrides `--print-timeout` and the outer watchdog. Default 900 (15m); the watchdog is that plus 60s grace. |
| `--sandbox` | Restricts terminal commands only. Not a read-only mode. |
| `--conversation <uuid>` | Resume a specific conversation. Fresh dispatch is the default. |
| `--continue` | Resume agy's most recent conversation. Machine-wide, so it may belong to another repository. |

## Reading the output

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/output-contract/contract.md"`

A non-zero exit from `delegate.mjs` means the run did not finish, not that agy's work is
wrong. Read the ⚠ lines. If a `/agy:resume` line is offered, resume rather than
re-dispatching.

After a job that changed code, read `git diff` for the files the brief named and run the
verification command the brief gave. Do not run the repository's whole test suite over a
slice.
