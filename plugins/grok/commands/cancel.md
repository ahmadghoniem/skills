---
description: Cancel an active Grok job (SIGTERM, then SIGKILL after 5 s).
argument-hint: '[job-id]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cancel.mjs" -- --arg-string "$ARGUMENTS"`

Surface the cancellation result to the user. If multiple running jobs exist, forward the error and ask which id to cancel.
