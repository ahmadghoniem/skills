---
description: Update the Antigravity CLI, then review the plugin's workarounds and open papercuts against what changed.
allowed-tools: Bash(node:*), Read, Grep, Glob
---

Run this with the Bash tool, `run_in_background: true`, then stop until the task
notification arrives. The download takes minutes.

    node "${CLAUDE_PLUGIN_ROOT}/scripts/update.mjs"

Present the old version, the new version, and the changelog entries it prints as-is. If
agy was already up to date, say so in one line and go straight to the papercuts.

Then review, and report findings only; the user picks which to apply:

- **The changelog against this plugin** (`scripts/`, `commands/`, `contract.md`,
  `agy-agents/`): which workarounds, retry logic, or documented caveats are no longer
  needed given what changed upstream.
- **The open papercuts** it prints, one cluster at a time. A cluster this release fixes:
  propose closing its cuts with `/agy:papercut --resolve <id> --note "..."`. A cluster of
  three or more that is still open: propose a fix. Read "Recurred after a recorded fix"
  first and do not re-propose a fix that did not hold. Judge from the evidence rows, not
  by re-running delegations. A cluster at one agy version only is an upstream
  regression; one spread across versions is ours.

For each fix, read the whole file first. Correct the sentence that is vague or wrong
rather than adding a note near the symptom, and remove guidance that is out of date.
Show the diff and the cut ids it addresses. If a cluster has no fix you believe in, say so.
