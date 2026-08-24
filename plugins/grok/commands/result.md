---
description: Print a finished Grok job's output, or `--list` the tracked jobs.
argument-hint: '[job-id] [--list] [--all]'
allowed-tools: Bash(node:*), Bash(cat:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/result.mjs" -- --arg-string "$ARGUMENTS"`

The output is grok's write-up. Relay it as-is — the user ran this command to see
the record, not a precis of it.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/output-contract/contract.md"`

If `--list` was passed, the output is a Markdown table of tracked jobs (the last 10, or all of them with `--all`) rather than a single result. Render it verbatim; running jobs are included, so do not filter them out.
