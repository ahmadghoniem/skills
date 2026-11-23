---
description: Health-check the opencode CLI.
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs"`

Present the check results as-is. If a check failed, tell the user concretely what to do
(install opencode with `bun add -g @opencode/cli`, set OPENCODE_BIN, or run
`/opencode:update`). Never run an installer yourself. `opencode models` lists the models
and `opencode auth list` the providers with keys.
