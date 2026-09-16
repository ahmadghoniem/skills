---
description: Record one friction point in the agy papercut log, for `/agy:kaizen` to read later.
argument-hint: '--source narrated --text "..." [--job <id>]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/papercut.mjs" -- --arg-string "$ARGUMENTS"`

The plugin automatically logs warnings it detects at the end of a run. Use this
command for one more source:

**`--source narrated`** — what agy said blocked it. Take it from agy's closing
report and quote it in `--text`; do not paraphrase it into a diagnosis.

Record observations without diagnosing causes; `/agy:kaizen` evaluates
clusters later.

Pass `--job <id>` and the run's model and conversation are filled in
from the record instead of being retyped.
