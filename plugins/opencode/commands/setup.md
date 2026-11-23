---
description: Health-check the opencode CLI, its providers, and the model allowlist.
argument-hint: '[--print-models] [--refresh]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --arg-string "$ARGUMENTS"`

Present the check results as-is: resolved binary path, version, authenticated providers, the live model count, and the allowlist.

If any check failed, say concretely what to do — install opencode (`npm i -g opencode-ai`, `bun add -g opencode-ai`, or the installer at opencode.ai), run `opencode auth login`, or set `OPENCODE_BIN`. Never run an installer yourself.

An **empty allowlist is the common failure**, and it blocks every dispatch by design: `opencode run` picks a model on its own when none is named, and that model may be metered. Point the user at `/opencode:models` to see the live list and `/opencode:models --allow <id>` to open one up.
