---
description: Print a finished Cursor job's output, or `--list` the tracked jobs.
argument-hint: '[job-id] [--list] [--all]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/result.mjs" -- --arg-string "$ARGUMENTS"`

Show the result block to the user as-is. Do not truncate or summarise — the user invoked this command specifically to see the full summary. If a `⚠ Commands that exited non-zero` section is present, keep it: it is the part most likely to contradict cursor-agent's own summary. End by noting the `cursor-agent --resume=…` line if present.

If `--list` was passed, the output is a Markdown table of tracked jobs (the last 10, or all of them with `--all`) rather than a single result. Render it verbatim as a compact table; running jobs are included, so do not filter them out.
