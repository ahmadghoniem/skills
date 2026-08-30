---
name: recall
description: Orient on the brief /snapshot wrote, injected by the last /clear.
disable-model-invocation: true
---

A brief from the prior session is injected at session start by the `SessionStart` hook
(matcher `clear`). If one is in context, this session began with a `/clear`.

If there is none, reply with exactly:

    Nothing to recall — no brief was injected at session start: either this session didn't
    begin with /clear, or no snapshot was taken. Run /snapshot in the session you're leaving,
    then /clear, then /recall.

and stop. Do not guess what the previous session was doing.

Otherwise orient. Take no edit action on this turn:

1. Read the whole brief.
2. Read the relevant files, starting from the ones the brief names — not everything
   changed in this repo belongs to this thread.

Then either:

- **The brief and those files are enough** — say what you would start on, in one line, and
  wait for the go-ahead. If the brief and the files disagree anywhere, add one line saying
  where; otherwise say nothing about it. Do not summarise the brief back.
- **The brief leaves a genuine gap** — call AskUserQuestion. Ask only for what cannot be
  found by reading. Never ask the user to confirm something the brief already says.

