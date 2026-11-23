---
description: Resume an opencode session (the latest in this repository, or a specific one) with an optional follow-up.
argument-hint: '[job-id|ses_…] [--prompt-file <path>] [--model <id>] [--fork] [follow-up task...]'
allowed-tools: Bash(node:*), Bash(cat:*), Write
---

Run this with the Bash tool, `run_in_background: true`, then stop until the task notification arrives:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/resume.mjs" -- --arg-string "$ARGUMENTS"

A follow-up longer than one line goes in a file written with the Write tool, passed as `--prompt-file`, as in `/opencode:delegate`.

With no argument this resumes the newest session recorded **in this repository**. It never falls back to opencode's own `--continue`, which resumes the most recent session on the machine and may belong to another project; pass `--continue` yourself if that is what you want.

`--fork` branches the session instead of continuing it, leaving the original untouched.

Find out what the stopped run already did before resuming — `git diff`, `git status`, or reading the files it touched, whichever fits. A run that stopped early has often already done most of the work, and a resume that re-does it is worse than no resume.
