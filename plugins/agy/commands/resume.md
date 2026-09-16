---
description: Resume the latest agy conversation (or a specific one) with an optional follow-up prompt.
argument-hint: '[job-id|conversation-uuid] [--prompt-file <path>] [--model <id>] [follow-up task...]'
allowed-tools: Bash(node:*), Bash(cat:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/resume.mjs" -- --arg-string "$ARGUMENTS"`

Treat the output like `/agy:delegate`. A job id (full, prefix, or 4-char suffix, this repository only) resumes that job's conversation; a UUID passes through as `--conversation`; with neither, the newest job in this repository that has a conversation id is resumed. If none has one, the command says so and stops; it never falls back to `--continue`.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/output-contract/contract.md"`

Run with the Bash tool's `run_in_background: true`.

Do not add `--add-dir`; resume is bound to the existing conversation, and the script omits it.
