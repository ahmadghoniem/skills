---
description: List opencode's live models, and manage which ones this plugin is allowed to spend on.
argument-hint: '[--refresh] [--allow <id>...] [--deny <id>...] [--default <id>] [--allowed]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/models.mjs" -- --arg-string "$ARGUMENTS"`

The list above is grouped by provider, with `(allowed)`, `(default)` and `(free)` marks. It is the live output of `opencode models`, cached for a week; `--refresh` refetches.

**Why an allowlist exists.** `opencode run` with no `--model` does not fail — it picks one of the configured models, which may be a metered one. Only the user knows which of their providers are flat-rate and which bill per token, so this plugin refuses to dispatch until they say. Nothing here guesses.

Relay the output as-is. Do not add a recommendation about which model to allow, and never allow one on the user's behalf without them naming it.

The allowlist lives in `~/.cod/config.json`, machine-wide, not per repository.
