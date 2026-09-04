---
description: Record one friction point in the agy papercut log, for `/agy:kaizen` to read later.
argument-hint: '--source <narrated|orchestrator> --text "..." [--job <id>]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/papercut.mjs" -- --arg-string "$ARGUMENTS"`

The plugin automatically logs warnings it detects at the end of a run. Use this
command to record two external sources:

**`--source narrated`** — what agy said blocked it. Take it from agy's closing
report and quote it in `--quote`; do not paraphrase it into a diagnosis.

**`--source orchestrator`** — a failure the brief caused. Use this after reading
back what came out of a delegation and finding that clearer instructions would
have prevented the problem. Record what you asked for (`--expected`), what came
back (`--got`), and the specific clause that failed (`--brief-excerpt`). Quote
the clause, not the whole brief.

Record observations without diagnosing causes; `/agy:kaizen` evaluates
clusters later.

Pass `--job <id>` and the run's model, conversation and file count are filled in
from the record instead of being retyped.
