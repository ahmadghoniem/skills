---
name: snapshot
description: Write a brief of this session for the next one to pick up after /clear.
argument-hint: "[focus / scope instructions]"
disable-model-invocation: true
---

Write one brief of this conversation to the OS temp directory.

Its reader is a fresh session that holds none of this conversation — it gets the
brief through `/recall`.

Path: `%TEMP%\claude-snapshot-<this-folder>.md` (this-folder = the current project
directory's name). Overwrite if it is already there. Do not write a second copy.
Do not write into the repo. The brief expires after 12 hours.

Before writing, ground yourself: inspect the repository and working tree to establish
what actually changed versus what you recall. Re-read, don't recall — re-open every file
you name, but do not re-run tests or commands just to fill a section. An honest gap beats
confident fiction.

Redact as you write: replace keys, tokens, passwords and personal data with a placeholder
that keeps the point (`sk-…REDACTED`). Don't drop the evidence line to dodge it.

Write these sections in order, omitting — heading included — any with nothing real
to hold:

- **State** — the objective, where the work actually stands, and any traps or fragile
  in-flight state.
- **Running** — what is still up and what only looks like it is: dev servers and their
  ports, background jobs, containers, the current branch, uncommitted or stashed work,
  artifact watches. Say which of it was started from this session — `/clear` drops those,
  so the next session should treat them as probably dead and check before relying on them
  — and which runs outside this session and is genuinely still up. Either way it will
  otherwise start a second copy on a port that is already taken.
- **Decisions** — what was chosen, ruled out, or tried and failed, each with its why and
  a verbatim quote or file:line behind it. Attribute each — *you decided* or *the user
  decided*: once the conversation is gone a judgment you made alone reads exactly like a
  ruling the user handed down, and the next session will treat both as settled. Cut what
  you cannot point at.
- **Still open** — questions raised but not settled. Say who has to settle each — *needs
  the user* or *yours to decide*; an undecided design question and an unstarted chore read
  identically otherwise, and the next session will act on both.
- **Artifacts** — every artifact this session published or worked from, each as its full
  URL with a short brief of what it is and where it stands. Nothing else carries the URL
  across `/clear`, and without it the next session publishes a second artifact instead of
  updating yours.
- **Files** — paths only, no guesses about what the next session will need. Do not
  duplicate what a document already captures (specs, plans, issues, commits) —
  reference those by path or URL.

If the user passed arguments, scope the whole brief to them. If they passed none and this
session covers more than one separable thread, call AskUserQuestion once — multi-select,
one option per thread, each named in a few words — and brief only what they pick. Work
that is really one thread gets no question: ask only where the answer changes what you
write.

When the file is written, tell the user to run `/clear`, then `/recall`.
