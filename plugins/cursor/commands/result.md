---
description: Print a finished Cursor job's output, or `--list` the tracked jobs.
argument-hint: '[job-id] [--list] [--all]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/result.mjs" -- "$ARGUMENTS"`

Show the result block to the user as-is. Do not truncate or summarise — the user invoked this command specifically to see the full summary. End by noting the `cursor-agent --resume=…` line if present.

If `--list` was passed, the output is a Markdown table of tracked jobs (the last 10, or all of them with `--all`) rather than a single result. Render it verbatim as a compact table; running jobs are included, so do not filter them out.
