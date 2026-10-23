---
description: Health-check the Cursor CLI and list available models.
argument-hint: '[--print-models]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --arg-string "$ARGUMENTS"`

Present the check results as-is. If any check failed, tell the user concretely what to do (install the Cursor CLI, run `cursor-agent login`, set CURSOR_AGENT_BIN). Do not run the installer or `cursor-agent login` yourself: the installer downloads and runs a script from cursor.com, and login opens a browser, which is the user's call.
