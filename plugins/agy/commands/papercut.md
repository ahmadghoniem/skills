---
description: Record one friction point in the agy papercut log, or close one once it is fixed.
argument-hint: '--text "..." [--session <id>] | --resolve <key|id> --note "..."'
allowed-tools: Bash(node:*)
---

Run it with the Bash tool, building the flags from what the user asked (`$ARGUMENTS`):

    node "${CLAUDE_PLUGIN_ROOT}/scripts/papercut.mjs" -- --text "<agy's words>" [--quote "<exact line>"] [--fix "<what would have prevented it>"] [--session <conversation id>] [--model <id>]
    node "${CLAUDE_PLUGIN_ROOT}/scripts/papercut.mjs" -- --resolve <key|id> --note "<what changed>"

The plugin logs agy's errors, its stderr on failed runs and its failed tool calls on
its own. Use this command to record what agy said blocked it: take it from agy's closing
report and quote it in `--text`; do not paraphrase it into a diagnosis. These cuts are
filed under the `narrated` key, and `/agy:update` reviews the clusters against each new
agy release.

Once the user has applied a fix, close the cuts it addresses with
`--resolve <key> --note "what changed"`, which closes every cut under that key
(`tool-errors:view_file`, `stderr`, ...) recorded so far. `--resolve <id>` closes
one cut. This appends a row and never edits the log, so a key that comes back
after its fix is flagged at the next review.
