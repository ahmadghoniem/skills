---
description: Print a finished opencode job's output, or `--list` the tracked jobs.
argument-hint: '[job-id] [--list] [--all]'
allowed-tools: Bash(node:*), Bash(cat:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/result.mjs" -- --arg-string "$ARGUMENTS"`

The output is opencode's report. Relay it as-is without summarizing.

For a running job the output is a one-paragraph progress line, not a result. Relay it and wait.

## Reading the output

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/output-contract/contract.md"`
