# Reading a grok run's output

A clean run prints grok's write-up, then `session: <id>` on the last line.
Relay the write-up as-is; `git diff` shows what changed.

Keep the session id: `--session <id>` continues that grok session with
everything it already read.

## The ⚠ lines

Lines beginning `⚠` are the ways a run can be wrong while still looking done.
Never drop one, never fold two into one verdict (grok's stop reason and the
exit code disagree in both directions), and never read them as a pass or fail
of the work. `delegate.mjs` exits 1 when one of them fires.

| id | Line | What it means |
| :--- | :--- | :--- |
| `stop-reason` | `⚠ stop reason: <reason>` | grok's stop reason when it is not `end_turn`, verbatim. `max_tokens` means the reply was cut off. |
| `exit` | `⚠ exit N` | grok's exit code. A good write-up with a stray non-zero exit is still a good write-up. |
| `error-detail` | `⚠ error: <reason>` | Why the run stopped, in grok's words, or the end of stderr when grok printed nothing else. "Not signed in", a rejected flag and an exhausted plan show up here. If the work is missing from the diff, continue the session rather than starting over. |

## Quota

A run that failed on a quota error naming a reset time ("Resets in 3h25m") blocks
that model until then: the next dispatch to it is refused before grok starts,
with the message and the reset time. Pick another model, or wait. A run that gets
through clears it. `~/.mngr/grok/quota.json` holds each model's last quota error.

## The update line

When a newer grok is out, one line after the output says so, once per release.
Ask the user whether to run `/mngr:update grok`; do not run it unasked.
