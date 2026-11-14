# Reading an agy run's output

On a clean run, the output is agy's own write-up and nothing else. Status
tables, run durations, file lists, and token counts are omitted; repository
changes are directly inspectable via `git status`.

Relay the write-up as-is without summarizing.

## The ⚠ lines

Lines beginning `⚠` are the exceptions the plugin does surface — the ways a run
can be wrong while agy still calls it done. Three rules govern all of them:

1. **Never drop one.** They are the only part of the output that is not
   recoverable by looking at the repo yourself.
2. **Never fold two into one verdict.** agy's own status, the process exit code,
   and what agy wrote to stderr are independent facts that disagree in both
   directions. Each is allowed to fire alone.
3. **Never infer a pass or fail from them.** The plugin reports facts; a ⚠ line
   is information, not a judgement.

`delegate.mjs` exits 1 when the run did not finish. That is a fact about the run, not a
verdict on the work: whatever agy wrote before it stopped is still in the tree, and the ⚠
lines say why.

## What the plugin can emit

| id | Line | What it means |
| :--- | :--- | :--- |
| `agy-status` | `⚠ agy status: <status> (write-up present)` | agy's own verdict, verbatim. Not a pass/fail: agy can report `ERROR` on runs that worked and `SUCCESS` on runs that did not. The parenthetical says only whether agy returned a write-up. Check `git diff` yourself for what changed. |
| `exit` | `⚠ exit N` | The process exit code. Independent of the line above; a good report with a stray non-zero exit is still a good report. `3` means the turn ended on a model or agent API error; agy then prints an `AGY_ERROR: {...}` line on stderr. |
| `stderr` | `⚠ agy wrote to stderr:` | What agy wrote to stderr (last 20 lines), on any run. agy is silent on stderr when nothing went wrong, so this carries startup failures (not signed in, rejected flag, spawn failure), its own timeout notice, background-task notes, network errors and the `AGY_ERROR` line. Read it before the `agy-error` line. |
| `tool-errors` | `⚠ N tool calls failed during the run — reported, not judged:` | Tools that failed while the run continued. Shows whether verification steps failed during a run reported as `SUCCESS`. Deduped and capped at three. |
| `compaction` | `⚠ agy compacted its context N time(s) during this run; check the diff against the brief` | agy replaced the conversation so far with a summary and kept going. Work after a compaction is where agy is most likely to redo something or drift from the brief; the summary does not always carry every earlier decision. |
| `agy-error` | `⚠ <agy's error>` | agy's own error text, first line first. A long tail is truncated with a count; the full text is in the job log. On an unknown model, the valid ids are listed instead. |
| `timeout` | `⚠ agy hit its print timeout after <duration>; the output is partial` | agy stops itself at `--print-timeout`, returns whatever it has and marks the result `finished_reason: print_timeout`. Its stderr carries a timeout notice and an `AGY_ERROR` line. `<duration>` is the Go duration token from the notice (`15s`, `1h0m0s`), verbatim, or `its limit` when agy printed no notice. |
| `finished-reason` | `⚠ agy ended the turn early: finished_reason <reason>` | agy's own `finished_reason`, verbatim, for any value except `print_timeout` (that one is the `timeout` line): `interrupted` when the run was cancelled, such as with Ctrl+C, `error` for any other failure. agy omits the field when the turn finished normally. Independent of `agy-status` and `exit`. |
| `resume` | `⚠ this run can be resumed where it stopped: /agy:resume <id>` | The run ended before agy finished (agy's timeout, a dropped connection, a quota error) and agy kept the conversation. Resuming keeps what agy already read and changed; a fresh dispatch starts from zero. agy may have finished the work before the error, so check the diff first: resume only if the work is missing, and prefer it to a new dispatch. |
