---
description: Resume the latest agy conversation (or a specific one) with an optional follow-up prompt.
argument-hint: '[job-id|conversation-uuid] [--model <id>] [follow-up task...]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/resume.mjs" -- --arg-string "$ARGUMENTS"`

Treat the output identically to `/agy:delegate` — it is the same pipeline. A job id looks up that job's `conversation_id`; a UUID is passed through as `--conversation`; with neither, the most recent conversation for this directory is continued.

Run it with the Bash tool's `run_in_background: true`, exactly like
`/agy:delegate` — same pipeline, same reason.

Do not add `--add-dir` on this path; a resume is bound to the conversation it
continues, and the script already omits it.
