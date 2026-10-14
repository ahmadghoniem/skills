---
description: Cancel an active grok job by force-killing grok and its child processes.
argument-hint: '[job-id]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cancel.mjs" -- --arg-string "$ARGUMENTS"`

Surface the cancellation result to the user. If multiple running jobs exist, forward the error and ask which id to cancel. Job ids resolve by full name, unique prefix, or the 4-char suffix alone, within this repository.

A job whose processes are already gone is reported as orphaned; nothing is killed.
