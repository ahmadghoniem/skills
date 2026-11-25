---
description: Record one friction point in a CLI's papercut log, or close one once it is fixed.
argument-hint: '<grok|agy|opencode> --text "..." [--session <id>] | <cli> --resolve <key|id> --note "..."'
allowed-tools: Bash(node:*)
---

Run it with the Bash tool, building the flags from what the user asked (`$ARGUMENTS`). The
first word names the CLI:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/papercut.mjs" -- <cli> --text "<the CLI's words>" [--quote "<exact line>"] [--fix "<what would have prevented it>"] [--session <id>] [--model <id>]
    node "${CLAUDE_PLUGIN_ROOT}/scripts/papercut.mjs" -- <cli> --resolve <key|id> --note "<what changed>"

mngr logs each CLI's errors on its own (agy's also its stderr on failed runs and its
failed tool calls; opencode's also the tools that could not run). Use this command to
record what the CLI said blocked it: take it from its closing report and quote it in
`--text`; do not paraphrase it into a diagnosis. These cuts are filed under the
`narrated` key, and `/mngr:update <cli>` reviews the clusters against each new release.
`--session` takes the id from the run's last line.

Once the user has applied a fix, close the cuts it addresses with
`--resolve <key> --note "what changed"`, which closes every cut under that key
(`narrated`, `tool-errors:view_file`, `stderr`, ...) recorded so far; `--resolve <id>`
closes one cut. This appends a row and never edits the log, so a key that comes back after
its fix is flagged at the next review.
