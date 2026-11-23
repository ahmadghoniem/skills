# Reading an opencode run's output

A clean run prints opencode's write-up, then `session: <id>` on the last line.
Relay the write-up as-is; `git diff` shows what changed. Keep the id:
`--session <id>` continues that session with everything opencode already read.

## The ⚠ lines

Lines beginning `⚠` are the ways a run can be wrong while still looking done.
Never drop one, and never read them as a pass or fail of the work.
`delegate.mjs` exits 1 when one of them fires; whatever opencode wrote before it
stopped is still in the tree.

| id | Line | What it means |
| :--- | :--- | :--- |
| `exit` | `⚠ exit N` | opencode's exit code. |
| `error-detail` | `⚠ error: <type>: <message>` | Why the run stopped, in opencode's words, or the end of stderr when it printed nothing else. `provider.quota`, `provider.auth` and `provider.no-route` mean the model is out of quota, not on the account, or not served: pick another from `opencode models` rather than retrying. If the work is missing from the diff, continue the session rather than starting over. |

## The update line

When a newer opencode is out, one line after the output says so, once per release.
Ask the user whether to run `/opencode:update`; do not run it unasked.
