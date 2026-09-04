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
   and the state of the working tree are independent facts that disagree in both
   directions. Each is allowed to fire alone.
3. **Never infer a pass or fail from them.** The plugin reports facts; a ⚠ line
   is information, not a judgement.

## What the plugin can emit

Every warning kind the renderer produces is registered here. `WARNING_IDS` in
`scripts/lib/render.mjs` is the machine-readable copy of this table, and
`tests/contract.test.mjs` fails if the two drift apart.

| id | Line | What it means |
| :--- | :--- | :--- |
| `agy-status` | `⚠ agy status: <status> (write-up present, N files changed)` | agy's own verdict, verbatim. Not a pass/fail: agy can report `ERROR` on runs that worked and `SUCCESS` on runs that did not. The parenthetical reports whether a write-up exists and the file count from before and after `git status --porcelain` snapshots. The file count is omitted outside a git repo. |
| `exit` | `⚠ exit N` | The process exit code. Independent of the line above; a good report with a stray non-zero exit is still a good report. |
| `stderr` | `⚠ agy produced no result. Its stderr:` | agy never started (unauthenticated, unknown `--model`, rejected flag, or spawn failure). Fires only when there is neither write-up nor status. The indented lines show the tail of stderr to indicate the fix: log in again, re-run `/agy:setup`, or wait. |
| `tool-errors` | `⚠ N tool calls failed during the run — reported, not judged:` | Tools that failed while the run continued. Shows whether verification steps failed during a run reported as `SUCCESS`. Deduped and capped at three. |
| `agy-error` | `⚠ <agy's error>` | agy's own error text, first line first. A long tail is truncated with a count; the full text is in the job log. |
| `watchdog` | `⚠ watchdog killed the run` | The print timeout plus 60s of grace elapsed and the plugin killed the process tree. The write-up, if any, is partial. |
| `resume` | `⚠ this run can be resumed where it stopped: /agy:resume <id>` | Fires alongside the watchdog line when the conversation id was captured on the `init` event. Re-dispatching the brief instead is an alternative if the run diverged before the timeout. |
| `wander` | `⚠ agy reported file changes but the working tree is unchanged` | agy reported file changes, but the working tree is unchanged; writes often landed in `~/.gemini/antigravity-cli/scratch`. Checked only inside a git repo. |
