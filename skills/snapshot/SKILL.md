---
name: snapshot
description: Write a one-shot conversation snapshot for the next /clear.
argument-hint: "What should the next session do first?"
disable-model-invocation: true
---

Write one snapshot of this conversation to the OS temp directory, then stop.

Path: `%TEMP%\claude-snapshot-<this-folder>.md` (this-folder = the current project directory's name). Overwrite if it is already there. Do not write a second copy. Do not write into the repo.

Lead with **Next action** — one concrete instruction the next session should start on. Then: Goal, Done, Still open, Files (paths only), Decisions, Suggested skills, Open questions.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

If the user passed arguments, treat them as the next session's focus and make that the Next action.

When the file is written, tell the user to run `/clear`, then `/recall`. The SessionStart hook reads that file into the new conversation and deletes it.
