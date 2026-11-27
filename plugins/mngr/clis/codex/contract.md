# Reading a codex run's output

A run's first line, printed as soon as codex names the thread, reads `model: <id> (codex) · session: <id>`. A run that is stopped or stuck can still be continued with that id. A clean run then prints codex's final messages, and `session: <id>` again on the last line.
Relay the write-up as-is; `git diff` shows what changed. Keep the id:
`--session <id>` continues that thread with everything codex already read.

## The ⚠ lines

Lines beginning `⚠` are the ways a run can be wrong while still looking done.
Never drop one, and never read them as a pass or fail of the work.
`delegate.mjs` exits 1 when one of them fires; whatever codex wrote before it
stopped is still in the tree.

| id | Line | What it means |
| :--- | :--- | :--- |
| `exit` | `⚠ exit N` | codex's exit code. |
| `error-detail` | `⚠ error: <message>` | Why the turn failed, in codex's words, or the end of stderr when it printed no JSON. "usage limit" means the plan's 5-hour or weekly window is spent: the council roster shows what is left. If the work is missing from the diff, continue the session rather than starting over. |

## Quota

A run that failed on a quota error naming a reset time blocks that model until then:
the next dispatch to it is refused before codex starts. A run that gets through clears
it. `~/.mngr/codex/quota.json` holds each model's last quota error.

## The update line

When a newer codex is out, one line after the output says so, once per release.
Ask the user whether to run `/mngr:update codex`; do not run it unasked.
