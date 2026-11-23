---
description: Update the Grok CLI, then review the plugin's workarounds and open papercuts against what changed.
allowed-tools: Bash(node:*), Bash(grok:*), Read, Grep, Glob
---

Run this with the Bash tool, `run_in_background: true`, then stop until the task
notification arrives. The download takes minutes.

    node "${CLAUDE_PLUGIN_ROOT}/scripts/update.mjs"

Present the old version, the new version, and the release list it prints as-is. If grok
was already up to date, say so in one line and go straight to the papercuts.

grok publishes no changelog, so the list holds only version numbers and dates from the npm
registry. Read what changed from grok itself: diff `grok --help` against
`~/.grok/bin/grok.exe.old --help` (the binary the update replaced), and read the bundled
docs under `~/.grok/docs/user-guide/`, which hold every flag, setting and event type.

Then review the release against the plugin. The goal is a plugin that stays minimal: every
flag, workaround and caveat in it should still earn its place on the new version. Judge
from the help diff, the bundled docs and the papercut evidence; do not run delegations to
check.

**Do these yourself, then report what you did:**

- **Correct what the release made wrong or unneeded** in `scripts/`, `commands/`,
  `contract.md` and `README.md`: a flag `buildArgs` in `scripts/lib/grok.mjs` passes that
  was renamed or removed, a `DISALLOWED_TOOLS` name that no longer matches a tool, a
  workaround grok now handles, a caveat that no longer holds. `--trust` and
  `--no-auto-update` are hidden flags: missing from `--help` is not removed. Read the
  whole file first, correct the sentence that is wrong rather than adding a note near it,
  and delete guidance that is out of date.
- **Describe only the version the plugin now requires** (`engines.grok`). Code comments
  and docs state how grok behaves now, not how an older version behaved ("checked on
  1.0.70 ..."). Version history belongs in `CHANGELOG.md` alone.
- **Close a papercut cluster when the help diff or the docs show the same error fixed**,
  with `/grok:papercut --resolve <key> --note "<what changed>"`, and a cluster whose cuts
  are all intended behaviour, with the note saying so. A fix that only probably covers a
  cluster is a proposal for the user instead.
- **Run `npm run test:grok`** from the repo root after any change.

**Bring to the user, as findings with a recommendation:**

- **Plugin features grok now does itself**: a new flag, setting or event that would let
  the plugin drop code.
- **Open papercut clusters of three or more.** Read "Recurred after a recorded fix" first
  and do not re-propose a fix that did not hold. A cluster at one grok version only is an
  upstream regression; one spread across versions is ours. Propose a fix, or say there is
  none you believe in.
- **Anything with a trade-off:** removing a feature, a change that needs a live run or
  quota, or one that changes what grok is told beyond correcting a fact.

For each change made or proposed, show the diff and the papercut ids it addresses.
