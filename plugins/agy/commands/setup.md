---
description: Health-check the Antigravity CLI and refresh the model cache.
argument-hint: '[--print-models]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --arg-string "$ARGUMENTS"`

Present the check results as-is: resolved binary path, version, and the model cache refresh. If any check failed, tell the user concretely what to do (install the Antigravity CLI, set AGY_BIN). Never attempt to run the installer yourself.

The model cache is also refreshed after any run once it is a week old, before a run whose `--model` is not in it, and whenever agy rejects a model name.
