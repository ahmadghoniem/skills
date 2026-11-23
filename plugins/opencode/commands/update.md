---
description: Update the opencode CLI, then review the plugin and open papercuts against what changed.
allowed-tools: Bash(node:*), Bash(opencode:*), Read, Grep, Glob, WebFetch
---

Run this with the Bash tool, `run_in_background: true`, then stop until the task
notification arrives.

    node "${CLAUDE_PLUGIN_ROOT}/scripts/update.mjs"

Present the old version, the new version and the release list it prints as-is. If
opencode was already up to date, say so in one line and go straight to the papercuts.

Read what changed from the release notes it links to and from `opencode run --help`. Then
review the release against the plugin, which should stay minimal: every flag and caveat in
`scripts/lib/opencode.mjs`, `commands/`, `contract.md` and `README.md` should still hold
on the new version. Correct what the release made wrong yourself, describe only the
version `engines.opencode` now requires, close papercut clusters the release fixed with
`/opencode:papercut --resolve <key> --note "<what changed>"`, and run
`npm run test:opencode` from the repo root after any change. Bring the user features
opencode now does itself, open clusters of three or more, and anything with a trade-off,
each with a recommendation.
