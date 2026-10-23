---
description: Update the Cursor CLI, then review the plugin's workarounds and open papercuts against what changed.
allowed-tools: Bash(node:*), Read, Grep, Glob
---

Run this with the Bash tool, `run_in_background: true`, then stop until the task
notification arrives. The download takes minutes.

    node "${CLAUDE_PLUGIN_ROOT}/scripts/update.mjs"

Present the old version, the new version and the changelog link it prints as-is. Cursor's
changelog is headed by date, not version; read the entries dated after the old version's
date. If cursor-agent was already up to date, say so in one line and go straight to the
papercuts.

Then review, and report findings only; the user picks which to apply:

- **The new version against this plugin** (`scripts/`, `commands/`, `contract.md`):
  run `cursor-agent --help` and compare it with the flags `buildArgs` in
  `scripts/lib/cursor.mjs` passes. `--disable-auto-update` and `--new-session-id` are
  hidden from the help; check them with a short run instead. Report flags that were
  renamed or removed, and workarounds or caveats in `docs/unverified.md` that the
  changelog shows are no longer needed.
- **The open papercuts** it prints, one cluster at a time. A cluster this release fixes:
  propose closing it with `/cursor:papercut --resolve <key> --note "..."`. A cluster of
  three or more that is still open: propose a fix. Read "Recurred after a recorded fix"
  first and do not re-propose a fix that did not hold. Judge from the evidence rows, not
  by re-running delegations. A cluster at one cursor-agent version only is an upstream
  regression; one spread across versions is ours.

For each fix, read the whole file first. Correct the sentence that is vague or wrong
rather than adding a note near the symptom, and remove guidance that is out of date.
Show the diff and the cut ids it addresses. If a cluster has no fix you believe in, say so.
