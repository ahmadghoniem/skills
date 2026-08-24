---
description: Print a finished Cursor job's output, or `--list` the tracked jobs.
argument-hint: '[job-id] [--list] [--all]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/result.mjs" -- --arg-string "$ARGUMENTS"`

The output is cursor-agent's write-up. Relay it as-is — the user ran this command
to see the record, not a precis of it. Lines starting `⚠` are the plugin's
warnings; keep every one, and keep them separate. `⚠ cursor-agent did not report
success` (the CLI's own verdict) and `⚠ exit N` (the process exit code) are
independent facts that disagree in both directions, and `⚠ N commands exited
non-zero` is the part most likely to contradict cursor-agent's own summary.

If `--list` was passed, the output is a Markdown table of tracked jobs (the last 10, or all of them with `--all`) rather than a single result. Render it verbatim as a compact table; running jobs are included, so do not filter them out.
