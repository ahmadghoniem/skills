---
description: Print a finished agy job's output, or `--list` the tracked jobs.
argument-hint: '[job-id] [--list] [--all]'
allowed-tools: Bash(node:*), Bash(cat:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/result.mjs" -- --arg-string "$ARGUMENTS"`

The output is agy's report. Relay it as-is — the user ran this command to see the
record, not a precis of it.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/output-contract/contract.md"`

If `--list` was passed, the output is a table of tracked jobs (the last 10, or all of them with `--all`) rather than a single result. Render it verbatim; running jobs are included, so do not filter them out.

Job ids resolve by full name, unique prefix, or the 4-char suffix alone.
