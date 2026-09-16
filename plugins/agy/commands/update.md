---
description: Update the Antigravity CLI and report what changed since the last version.
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/update.mjs"`

Present the old version, the new version, and the changelog entries above as-is. If the
output says agy is already up to date, report only that.

Otherwise, read the changelog entries against this plugin (its scripts under `scripts/`,
its commands under `commands/`, and `docs/`) and say which of its existing workarounds,
retry logic, or documented caveats are no longer needed given what changed upstream. Do
not change any code — report findings only, for a human to act on.

`/agy:setup` stays the health check; this command only updates and diffs the changelog.
