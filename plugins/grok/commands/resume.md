---
description: Resume the latest Grok session (or a specific one) with an optional follow-up prompt.
argument-hint: '[--resume=session-id] [--model <id>] [--background] [follow-up task...]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/resume.mjs" -- --arg-string "$ARGUMENTS"`

Treat the output identically to `/grok:delegate` — it is the same pipeline, just with `--resume` injected.
