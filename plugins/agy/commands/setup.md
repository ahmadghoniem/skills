---
description: Health-check the Antigravity CLI, refresh the model cache, and register the bash tool.
argument-hint: '[--print-models]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --arg-string "$ARGUMENTS"`

Present the check results as-is: resolved binary path, version, the model cache refresh, and the agy plugin that carries the agent and its bash tool. If any check failed, tell the user concretely what to do (install the Antigravity CLI, set AGY_BIN, fix the JSON in `~/.gemini/config/mcp_config.json`). Never attempt to run the installer yourself.

The model cache is also refreshed after any run once it is a week old, and whenever agy rejects a model name.
