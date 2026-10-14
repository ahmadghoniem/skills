---
description: Print a finished grok job's output, or `--list` the tracked jobs.
argument-hint: '[job-id] [--list] [--all]'
allowed-tools: Bash(node:*), Bash(cat:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/result.mjs" -- --arg-string "$ARGUMENTS"`

The output is grok's write-up.

For a running job the output is a one-paragraph progress line, not a result. Relay it and wait.

!`cat "${CLAUDE_PLUGIN_ROOT}/contract.md"`

If `--list` was passed, the output is a plain list of tracked jobs (the last 10, or all of them with `--all`) rather than a single result. Render it verbatim; running and orphaned jobs are included, so do not filter them out.

Job ids resolve by full name, unique prefix, or the 4-char suffix alone, within this repository.
