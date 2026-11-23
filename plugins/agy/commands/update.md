---
description: Update the Antigravity CLI, then review the plugin's workarounds and open papercuts against what changed.
allowed-tools: Bash(node:*), Read, Grep, Glob
---

Run this with the Bash tool, `run_in_background: true`, then stop until the task
notification arrives. The download takes minutes.

    node "${CLAUDE_PLUGIN_ROOT}/scripts/update.mjs"

Present the old version, the new version, and the changelog entries it prints as-is. If
agy was already up to date, say so in one line and go straight to the papercuts.

Then review the release against the plugin. The goal is a plugin that stays minimal: every
rule, workaround and caveat in it should still earn its place on the new version, and none
should burden the Claude models or agy's own harness. Judge from the changelog, the papercut evidence
and agy's binary; do not run delegations or benchmarks to check.

**Do these yourself, then report what you did:**

- **Correct what the release made wrong or unneeded** in `scripts/`, `mcp/`, `commands/`,
  `contract.md`, `README.md` and `agy-agents/`: a workaround agy now handles, retry logic
  it now does itself, a caveat that no longer holds. Read the whole file first, correct
  the sentence that is wrong rather than adding a note near it, and delete guidance that
  is out of date.
- **Describe only the version the plugin now requires.** Docs and the agent state how agy
  behaves now, not how an older version behaved ("before 1.5.13 ..."). Version history
  belongs in `CHANGELOG.md` alone.
- **Close a papercut cluster when a changelog line names the same error**, with
  `/agy:papercut --resolve <key> --note "<that changelog line>"`. A fix that only probably
  covers a cluster is a proposal for the user instead.
- **Run `npm run test:agy`** from the repo root after any change.

**Bring to the user, as findings with a recommendation:**

- **Changes to how the default agent works.** `bash-delegate` sets
  `excludeDefaultComponents: true`, so it does not get agy's new default prompt text.
  Pull the new text out of the binary (`rg -a` on `agy.exe`, and diff against the
  previous `agy.exe.*.old` beside it), compare it rule by rule with
  `agy-agents/bash-delegate.md`, and measure from recorded jobs how often our agent does
  what each new rule targets. Recommend which to borrow.
- **Papercut clusters this release may fix**, with the changelog line and why it is not
  certain, proposed for closing.
- **Open papercut clusters of three or more.** Read "Recurred after a recorded fix" first
  and do not re-propose a fix that did not hold. A cluster at one agy version only is an
  upstream regression; one spread across versions is ours. Propose a fix, or say there
  is none you believe in.
- **Anything with a trade-off:** removing a feature, a change that needs quota, or one
  that changes what the model is told beyond correcting a fact.

For each change made or proposed, show the diff and the papercut ids it addresses.
