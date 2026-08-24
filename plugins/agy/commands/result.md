---
description: Print a finished agy job's output, or `--list` the tracked jobs.
argument-hint: '[job-id] [--list] [--all]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/result.mjs" -- --arg-string "$ARGUMENTS"`

The output is agy's report. Relay it as-is — the user ran this command to see the
record, not a precis of it. Lines starting `⚠` are the plugin's warnings; keep
every one, and keep them separate. agy's `status`, the process exit code, and the
git working tree are three independent facts that disagree in both directions, so
never collapse them into a single pass/fail. A wander warning means the writes
landed in `~/.gemini/antigravity-cli/scratch` rather than the repo.

If `--list` was passed, the output is a table of tracked jobs (the last 10, or all of them with `--all`) rather than a single result. Render it verbatim; running jobs are included, so do not filter them out.

Job ids resolve by full name, unique prefix, or the 4-char suffix alone.
