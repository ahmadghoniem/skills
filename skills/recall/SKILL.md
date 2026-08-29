---
name: recall
description: Resume from the snapshot injected by the last /clear.
disable-model-invocation: true
---

The prior session's brief was injected into this conversation at session start, as a block beginning `CONVERSATION SNAPSHOT`.

Begin executing **Next action** from that brief now.

Do not summarise the brief back to the user. Do not re-run anything listed under Done, and do not re-invoke skills recorded there — that work is finished.

If there is no `CONVERSATION SNAPSHOT` block in context, say so in one line and stop. Do not guess what the previous session was doing.
