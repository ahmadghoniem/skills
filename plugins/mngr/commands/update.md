---
description: Update grok, agy, opencode and codex (or the one named), then review mngr's workarounds and open papercuts against what changed.
argument-hint: '[grok|agy|opencode|codex]'
allowed-tools: Bash(node:*), Bash(grok:*), Bash(agy:*), Bash(opencode:*), Read, Grep, Glob, WebFetch
---

Run this with the Bash tool, `run_in_background: true`, then stop until the task
notification arrives; a download takes minutes. `$ARGUMENTS` names the CLI; with none,
leave it out and every CLI is updated in turn:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/update.mjs" -- [<cli>]

For each CLI, present the old version, the new version and the release list it prints
as-is. If a CLI was already up to date, say so in one line and go straight to its
papercuts.

Then, for each CLI the output covers, read `${CLAUDE_PLUGIN_ROOT}/clis/<cli>/update.md`
and review the release as it says.
