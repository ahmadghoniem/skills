---
description: Record one friction point in the opencode papercut log, or close one once it is fixed.
argument-hint: '--text "..." [--session <id>] | --resolve <key|id> --note "..."'
allowed-tools: Bash(node:*)
---

Run it with the Bash tool, building the flags from what the user asked (`$ARGUMENTS`):

    node "${CLAUDE_PLUGIN_ROOT}/scripts/papercut.mjs" -- --text "<opencode's words>" [--quote "<exact line>"] [--fix "<what would have prevented it>"] [--session <ses_id>] [--model <id>]
    node "${CLAUDE_PLUGIN_ROOT}/scripts/papercut.mjs" -- --resolve <key|id> --note "<what changed>"

The plugin logs opencode's errors and tools that could not run on its own. Use this
command to record what opencode said blocked it: quote its closing report in `--text`; do
not paraphrase it into a diagnosis. `/opencode:update` reviews the clusters against each
new opencode release.
