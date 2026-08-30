---
description: Resume a named Grok session with an optional follow-up prompt.
argument-hint: '--resume=<job-id> [--model <id>] [follow-up task...]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/resume.mjs" -- --arg-string "$ARGUMENTS"`

Treat the output identically to `/grok:delegate` — it is the same pipeline, just with `--resume` injected.

A job id is required — a bare `--resume` is refused, and the script's error explains why.
The id is above the run's output in this transcript, or in `/grok:result --list`.
