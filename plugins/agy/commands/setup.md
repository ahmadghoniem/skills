---
description: Health-check the Antigravity CLI and install the agy plugin that carries the bash tool.
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs"`

Present the check results as-is: resolved binary path, version, and the agy plugin that carries the agent and its bash tool. If any check failed, tell the user concretely what to do (install the Antigravity CLI, set AGY_BIN, fix the JSON in `~/.gemini/config/mcp_config.json`). Never attempt to run the installer yourself. For the model list, run `agy models`.
