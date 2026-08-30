---
name: snapshot
description: Write a brief of this session for the next one to pick up after /clear.
argument-hint: "[focus / scope instructions]"
disable-model-invocation: true
---

Write one brief of this conversation to `%TEMP%\claude-snapshot-<this-folder>.md`
(this-folder = the current project directory's name). Overwrite if it is already
there. Do not write into the repo.

Before writing, ground yourself: inspect the repository and working tree to establish
what actually changed versus what you recall. Re-read, don't recall — re-open every file
you name, but do not re-run tests or commands just to fill a section. An honest gap beats
confident fiction.

Write these sections in order, omitting — heading included — any with nothing real
to hold:

- **State** — open with one line marking this as the prior session's brief, then the
  objective, where the work actually stands, and any traps or fragile in-flight state.
- **Decisions** — what was chosen, ruled out, or tried and failed, each with its why.
  Chosen and ruled out count only if the user said or approved them; your own
  suggestions are not decisions.
- **Still open** — questions raised but not settled.
- **Files** — paths only, no guesses about what the next session will need. Do not
  duplicate what other artifacts already capture (specs, plans, issues, commits) —
  reference those by path or URL.

A claim under Decisions needs a verbatim quote or a file:line behind it. If you cannot
point to one, cut the claim.

Close with **Next step** only if one was explicitly agreed — quote the words that agreed
it. If none was, leave the heading out; do not invent one.

If the user passed arguments, scope the whole brief to them.

When the file is written, tell the user to run `/clear`, then `/recall`.
