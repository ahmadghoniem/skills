---
description: Health-check the Grok CLI and list available models.
argument-hint: '[--print-models]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --arg-string "$ARGUMENTS"`

Present the check results as-is. If any check failed, tell the user concretely what to do (install the Grok CLI, run `grok login`, set GROK_BIN). Do not run the installer yourself: it downloads and runs a script from x.ai and changes PATH, which is the user's call.
