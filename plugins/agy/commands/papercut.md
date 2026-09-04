---
description: Record one friction point in the agy papercut log, for `/agy:kaizen` to read later.
argument-hint: '--source <narrated|orchestrator> --text "..." [--job <id>]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/papercut.mjs" -- --arg-string "$ARGUMENTS"`

Warnings the plugin can see for itself are already logged automatically when a
run finishes. This command is for the two kinds it cannot see.

**`--source narrated`** — the delegatee's own account of what got in its way.
Take it from agy's closing report and quote it in `--quote`; do not paraphrase
it into a diagnosis.

**`--source orchestrator`** — a failure the brief caused. Use this after reading
back what came out of a delegation and finding that clearer instructions would
have prevented the problem. Record what you asked for (`--expected`), what came
back (`--got`), and the specific clause that failed (`--brief-excerpt`). Quote
the clause, not the whole brief.

Record what happened; do not work out why. You have just written the brief that
failed, which makes you the worst available judge of why it failed — the
temptation is to construct a tidy story, and a tidy wrong story is harder to
correct later than a bare fact. `/agy:kaizen` does the reading, later, with the
whole cluster in view and none of this context.

Pass `--job <id>` and the run's model, conversation and file count are filled in
from the record instead of being retyped.
