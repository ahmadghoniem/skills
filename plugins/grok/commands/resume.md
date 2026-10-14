---
description: Resume a grok job's session (or the newest one in this repository) with a follow-up prompt.
argument-hint: '[job-id|session-uuid] [--prompt-file <path>] [--effort low|medium] [follow-up task...]'
allowed-tools: Bash(node:*), Bash(cat:*), Write
---

Run this with the Bash tool, `run_in_background: true`, then stop until the task notification arrives:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/resume.mjs" -- --arg-string "$ARGUMENTS"

A follow-up longer than one line goes in a file written with the Write tool, passed as `--prompt-file`, as in `/grok:delegate`. Send only what is new; grok keeps everything it already read and changed in that session.

A job id (full, prefix, or 4-char suffix, this repository only) resumes that job's session; a UUID passes through as `--session`; with neither, the newest job in this repository that has a session id is resumed. If none has one, the command says so and stops; it never falls back to grok's `--continue`.

## Reading the output

!`cat "${CLAUDE_PLUGIN_ROOT}/contract.md"`
