---
description: Record one friction point in the agy papercut log, or close one once it is fixed.
argument-hint: '--source narrated --text "..." [--job <id>] | --resolve <id> --note "..."'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/papercut.mjs" -- --arg-string "$ARGUMENTS"`

The plugin automatically logs warnings it detects at the end of a run. Use this
command for one more source:

**`--source narrated`** — what agy said blocked it. Take it from agy's closing
report and quote it in `--text`; do not paraphrase it into a diagnosis.

Record observations without diagnosing causes; `/agy:update` reviews the
clusters against each new agy release.

Pass `--job <id>` and the run's model and conversation are filled in
from the record instead of being retyped.

Once the user has applied a fix, close the cuts it addresses with
`--resolve <id> --note "what changed"`. This appends a row and never edits the
log, so a cluster that comes back after its fix is flagged at the next review.
