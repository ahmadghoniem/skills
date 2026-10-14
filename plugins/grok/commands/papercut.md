---
description: Record one friction point in the grok papercut log, or close one once it is fixed.
argument-hint: '--text "..." [--job <id>] | --resolve <key|id> --note "..."'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/papercut.mjs" -- --arg-string "$ARGUMENTS"`

The plugin automatically logs warnings it detects at the end of a run (`wander`,
`error-detail`, `killed`, `failed-commands`). Use this command to record what grok
said blocked it: take it from grok's closing report and quote it in `--text`; do not
paraphrase it into a diagnosis. These cuts are filed under the `narrated` key.

Record observations without diagnosing causes; `/grok:update` reviews the
clusters against each new grok release.

Pass `--job <id>` and the run's model and session are filled in from the record
instead of being retyped.

Once the user has applied a fix, close the cuts it addresses with
`--resolve <key> --note "what changed"`, which closes every cut under that key
(`wander`, `failed-commands`, `narrated`, ...) recorded so far. `--resolve <id>` closes
one cut. This appends a row and never edits the log, so a key that comes back
after its fix is flagged at the next review.
