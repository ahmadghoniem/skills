---
description: Update the opencode CLI and report what changed since the last version.
argument-hint: '[target-version]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/update.mjs" -- --arg-string "$ARGUMENTS"`

Present the old version, the new version, and the release notes above as-is. If the output says opencode is already up to date, report only that.

Otherwise read the notes against this plugin — its scripts under `scripts/`, its commands under `commands/`, and `skills/output-contract/contract.md` — and say which of its assumptions the new version affects. The ones worth checking on every bump:

- the `--format json` event shape (`step_start`, `tool_use`, `text`, `step_finish`) that `scripts/lib/parse.mjs` reads
- whether `opencode run` still picks a model of its own when `--model` is absent, which is the reason the allowlist gate exists
- whether `--auto`, `--variant`, `--session`, `--fork` or `--dir` changed meaning
- whether `run` gained a timeout flag, which would make the plugin's watchdog redundant

The install method is inferred from where the binary lives. If the upgrade reports no change but a newer version exists, the inference was probably wrong — tell the user to upgrade through whichever package manager installed it.
