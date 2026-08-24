---
description: Health-check the Antigravity CLI and list available models.
argument-hint: '[--print-models]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --arg-string "$ARGUMENTS"`

Present the check results as-is: resolved binary path, version, and the live model list from `agy models`. If any check failed, tell the user concretely what to do (install the Antigravity CLI, set AGY_BIN). Never attempt to run the installer yourself.
