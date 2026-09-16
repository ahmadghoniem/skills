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
verdict on the work; the ⚠ lines say why.

## What the plugin can emit

Every warning kind the renderer produces is registered here. `WARNING_IDS` in
`scripts/lib/render.mjs` is the machine-readable copy of this table, and
`tests/contract.test.mjs` fails if the two drift apart.

| id | Line | What it means |
| :--- | :--- | :--- |
| `agy-status` | `⚠ agy status: <status> (write-up present)` | agy's own verdict, verbatim. Not a pass/fail: agy can report `ERROR` on runs that worked and `SUCCESS` on runs that did not. The parenthetical says only whether agy returned a write-up. Check `git diff` yourself for what changed. |
| `exit` | `⚠ exit N` | The process exit code. Independent of the line above; a good report with a stray non-zero exit is still a good report. |
| `stderr` | `⚠ agy wrote to stderr:` | Everything agy wrote to stderr (last 20 lines), on any run. agy is silent on stderr when nothing went wrong, so this carries startup failures (not signed in, unknown `--model`, rejected flag, spawn failure), its own timeout notice, background-task notes and network errors. Read it before the `error` line: on a 1.2.2 timeout it is the only record. |
| `tool-errors` | `⚠ N tool calls failed during the run — reported, not judged:` | Tools that failed while the run continued. Shows whether verification steps failed during a run reported as `SUCCESS`. Deduped and capped at three. |
| `compaction` | `⚠ agy compacted its context N time(s) during this run; check the diff against the brief` | agy replaced the conversation so far with a summary and kept going. Work after a compaction is where agy is most likely to redo something or drift from the brief; the summary does not always carry every earlier decision. |
| `denied` | `⚠ agy skipped N action(s) it was not allowed to take:` | Tool actions agy refused to run for permission reasons, listed underneath. The plugin passes `--dangerously-skip-permissions`, so this should never fire; if it does, agy skipped work silently and the run is incomplete whatever its status says. |
| `agy-error` | `⚠ <agy's error>` | agy's own error text, first line first. A long tail is truncated with a count; the full text is in the job log. |
| `watchdog` | `⚠ watchdog killed the run` | The print timeout plus 60s of grace elapsed and the plugin killed the process tree. The write-up, if any, is partial. |
| `timeout` | `⚠ agy hit its print timeout after <duration>; the output is partial` | agy 1.1.28+ stops itself at `--print-timeout` and returns whatever it has, with status `SUCCESS` and exit 0 — nothing else marks this. `<duration>` is agy's own Go duration token (`15s`, `1h0m0s`), verbatim. |
| `resume` | `⚠ this run can be resumed where it stopped: /agy:resume <id>` | The run ended before agy finished (agy's timeout, the watchdog, a dropped connection, a quota error) and agy kept the conversation. Resuming keeps what agy already read and changed; a fresh dispatch starts from zero. Prefer resume unless the run had clearly gone wrong before it stopped. |
