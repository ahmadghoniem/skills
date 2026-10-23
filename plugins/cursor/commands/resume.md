---
description: Resume a Cursor job's chat (or the newest one in this repository) with a follow-up prompt.
argument-hint: '[job-id|chat-id] [--prompt-file <path>] [follow-up task...]'
allowed-tools: Bash(node:*), Bash(cat:*), Write
---

Run this with the Bash tool, `run_in_background: true`, then stop until the task notification arrives:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/resume.mjs" -- --arg-string "$ARGUMENTS"

A follow-up longer than one line goes in a file written with the Write tool, passed as `--prompt-file`, as in `/cursor:delegate`. Send only what is new; Cursor keeps everything it already read and changed in that chat.

A job id (full, prefix, or 4-char suffix, this repository only) resumes that job's chat; a chat id (a UUID) passes through as `--session`; with neither, the newest job in this repository that has a chat id is resumed. If none has one, the command says so and stops; it never falls back to cursor-agent's `--continue`, which picks the newest chat in the directory whoever started it.

## Reading the output

!`cat "${CLAUDE_PLUGIN_ROOT}/contract.md"`
