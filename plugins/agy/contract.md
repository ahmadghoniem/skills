# Reading an agy run's output

A clean run prints agy's own report, then `conversation: <id>` on the last line.
Relay the report as-is; `git diff` shows what changed. Keep the id:
`--conversation <id>` continues that conversation with everything agy already read.

## The ⚠ lines

Lines beginning `⚠` are the ways a run can be wrong while agy still calls it
done. Never drop one; never fold two into one verdict (agy's status, the exit
code and its stderr disagree in both directions); never read them as a pass or
fail of the work. `delegate.mjs` exits 1 when the run did not finish, and
whatever agy wrote before it stopped is still in the tree.

| id | Line | What it means |
| :--- | :--- | :--- |
| `agy-status` | `⚠ agy status: <status> (write-up present)` | agy's own verdict, verbatim, when it is not `SUCCESS`. `ERROR` comes back on runs whose work landed too; the parenthetical says only whether a report came back. Check `git diff`. |
| `exit` | `⚠ exit N` | The process exit code. `3` means the turn ended on a model or agent API error. |
| `stderr` | `⚠ agy wrote to stderr:` | Shown only on a run that did not finish: startup failures (not signed in, a rejected flag), network errors and the `AGY_ERROR` line. Read it before the `agy-error` line. |
| `agy-error` | `⚠ <agy's error>` | agy's own error text, first line first. On an unknown model, the valid ids are listed instead. |
| `finished-reason` | `⚠ agy ended the turn early: finished_reason <reason>` | agy's reason for ending the turn early, verbatim: `print_timeout`, `interrupted`, `error`. If the work is missing from the diff, continue the conversation rather than starting over. |

## The update line

When a newer agy is out, one line after the output says so, once per release.
Ask the user whether to run `/agy:update`; do not run it unasked.
