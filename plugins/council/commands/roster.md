---
description: Show the council roster: each seat's role, model, effort, CLI version and last quota error.
argument-hint: '[council name]'
allowed-tools: Bash(node:*)
---

Run with the Bash tool, adding `--council <name>` when the user named one (`$ARGUMENTS`):

    node "${CLAUDE_PLUGIN_ROOT}/scripts/roster.mjs"

Show the table as-is. With no council named, it lists one seat per member plugin on its
default model.
