---
description: Resume the latest agy conversation (or a specific one) with an optional follow-up prompt.
argument-hint: '[job-id|conversation-uuid] [--model <id>] [follow-up task...]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/resume.mjs" -- --arg-string "$ARGUMENTS"`

Treat the output identically to `/agy:delegate`. A job id looks up that job's `conversation_id`; a UUID passes through as `--conversation`; with neither, the command continues the most recent conversation for this directory.

Run with the Bash tool's `run_in_background: true`.

Do not add `--add-dir`; resume is bound to the existing conversation, and the script omits it.
