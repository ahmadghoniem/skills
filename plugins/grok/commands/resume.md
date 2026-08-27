---
description: Resume a named Grok session with an optional follow-up prompt.
argument-hint: '--resume=<job-id|session-uuid> [--model <id>] [follow-up task...]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/resume.mjs" -- --arg-string "$ARGUMENTS"`

Treat the output identically to `/grok:delegate` — it is the same pipeline, just with `--resume` injected.

An id is required. `<id>` is either the **job id** printed when the run was dispatched, or a
grok **session uuid** — the form the `resumable` warning prints after a watchdog kill. A bare
`--resume` is refused rather than guessed at: jobs from every Claude session working in this
directory land in one shared store, so "the most recent" may belong to a conversation this
session never had. The job id you want is in this transcript, above the run's output; run
`/grok:result --list` if it has scrolled away.
