---
description: Health-check the Antigravity CLI, refresh the model cache, and register the bash tool.
argument-hint: '[--print-models]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --arg-string "$ARGUMENTS"`

Present the check results as-is: resolved binary path, version, the model cache refresh, and the bash tool's MCP config entry. If any check failed, tell the user concretely what to do (install the Antigravity CLI, set AGY_BIN, fix the JSON in `~/.gemini/config/mcp_config.json`). Never attempt to run the installer yourself.

The model cache is also refreshed after any run once it is a week old, before a run whose `--model` is not in it, and whenever agy rejects a model name.
