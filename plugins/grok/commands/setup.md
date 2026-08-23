---
description: Health-check the Grok CLI and list available models.
argument-hint: '[--print-models]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --arg-string "$ARGUMENTS"`

Present the check results as-is. If any check failed, tell the user concretely what to do (install the Grok CLI, run `grok login`, set GROK_BIN). Never attempt to run the installer yourself.
