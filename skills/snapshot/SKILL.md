---
name: snapshot
description: Write a brief of this session for the next one to pick up after /clear.
argument-hint: "[focus / scope instructions]"
disable-model-invocation: true
---

Write one brief of this conversation to the OS temp directory.

Its reader is a fresh session that holds none of this conversation. It starts from
this brief.

Path: `%TEMP%\claude-snapshot-<parent>-<folder>.md`. Overwrite if it is already
there. Do not write into the repo.

Before writing: do not re-run tests or commands just to fill a section. Where you
cannot establish something, write that instead of guessing.

Redact as you write: replace keys, tokens, passwords and personal data with a placeholder
that keeps the point (`sk-…REDACTED`). Don't drop the evidence line to dodge it.

Where a document already captures something — a spec, plan, ADR, issue, commit or diff
— reference it by path or URL instead of restating it.

Write these sections in order, omitting — heading included — any with nothing real
to hold:

- **State** — open with the next action if one was decided, phrased as the action rather
  than a status; otherwise **Still open** carries it. Then the objective, where the work
  actually stands, and any traps or fragile in-flight state.
- **Running** — dev servers with their port, what each one is serving, and the PID;
  background jobs; containers; stashed work. A session that does not know the server is
  up will start a second one, and the collision will not stop it: the new server takes
  the next free port and reports a normal start.
- **Decisions** — what was chosen, ruled out, or tried and failed, each with its why and
  a verbatim quote or file:line from this conversation behind it. Attribute each — *you
  decided* or *the user decided*: once the conversation is gone a judgment you made alone
  reads exactly like a ruling the user handed down, and the next session will treat both
  as settled. Cut what you cannot point at.
- **Still open** — questions raised but not settled. Say who has to settle each — *needs
  the user* or *yours to decide*.
- **Artifacts** — every artifact this session published or worked from, each as its full
  URL with a short brief of what it is and where it stands.
- **Files** — paths only, no guesses about what the next session will need.

If the user passed arguments, scope the whole brief to them. If they passed none and this
session covers more than one separable thread, call AskUserQuestion once — multi-select,
one option per thread, each named in a few words — and brief only what they pick. Work
that is really one thread gets no question: ask only where the answer changes what you
write.

When the file is written, tell the user to run `/clear`, then `/recall`.
