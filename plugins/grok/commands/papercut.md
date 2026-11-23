---
description: Record one friction point in the grok papercut log, or close one once it is fixed.
argument-hint: '--text "..." [--session <id>] | --resolve <key|id> --note "..."'
allowed-tools: Bash(node:*)
---

Run it with the Bash tool, building the flags from what the user asked (`$ARGUMENTS`):

    node "${CLAUDE_PLUGIN_ROOT}/scripts/papercut.mjs" -- --text "<grok's words>" [--quote "<exact line>"] [--fix "<what would have prevented it>"] [--session <id>] [--model <id>]
    node "${CLAUDE_PLUGIN_ROOT}/scripts/papercut.mjs" -- --resolve <key|id> --note "<what changed>"

The plugin logs grok's errors on its own (`error-detail`). Use this command to record
what grok said blocked it: take it from grok's closing report and quote it in `--text`;
do not paraphrase it into a diagnosis. These cuts are filed under the `narrated` key,
and `/grok:update` reviews the clusters against each new grok release. `--session`
takes the id from the run's last line.

Once the user has applied a fix, close the cuts it addresses with
`--resolve <key> --note "what changed"`, which closes every cut under that key recorded
so far; `--resolve <id>` closes one cut. This appends a row and never edits the log, so a
key that comes back after its fix is flagged at the next review.
