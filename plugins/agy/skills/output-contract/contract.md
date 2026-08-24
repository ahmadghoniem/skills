# Reading an agy run's output

On a clean run the output is agy's own write-up and nothing else. No status
table, no duration, no file list, no token count. That silence is deliberate:
everything omitted is either already visible to you (`git status` is one call
away) or noise on the overwhelming majority of runs that simply worked.

Relay the write-up as-is. The user asked for the record, not a precis of it.

## The ⚠ lines

Lines beginning `⚠` are the exceptions the plugin does surface — the ways a run
can be wrong while agy still calls it done. Three rules govern all of them:

1. **Never drop one.** They are the only part of the output that is not
   recoverable by looking at the repo yourself.
2. **Never fold two into one verdict.** agy's own status, the process exit code,
   and the state of the working tree are independent facts that disagree in both
   directions. Each is allowed to fire alone.
3. **Never infer a pass or fail from them.** The plugin deliberately does not
   decide; it puts the fact in front of a human. A ⚠ line is information, not a
   judgement.

## What the plugin can emit

Every warning kind the renderer produces is registered here. `WARNING_IDS` in
`scripts/lib/render.mjs` is the machine-readable copy of this table, and
`tests/contract.test.mjs` fails if the two drift apart.

| id | Line | What it means |
| :--- | :--- | :--- |
| `agy-status` | `⚠ agy status: <status>` | agy's own verdict, verbatim. Not a pass/fail — agy reports `ERROR` on runs that worked and `SUCCESS` on runs that did not. |
| `exit` | `⚠ exit N` | The process exit code. Independent of the line above; a good report with a stray non-zero exit is still a good report. |
| `stderr` | `⚠ agy produced no result. Its stderr:` | agy never got started — not authenticated, unknown `--model`, rejected flag, spawn failure. Only fires when there is *no* write-up and *no* status, because stderr is then the only explanation that exists. The following indented lines are the tail of stderr, and they tell you which fix applies: log in again, re-run `/agy:setup`, or wait. |
| `tool-errors` | `⚠ N tool calls failed during the run — reported, not judged:` | Tools that failed while the run continued. agy recovers from most of these and is right to. The case that matters is a failed verification step under a `SUCCESS` status — you asked for the tests to pass, the test command failed, agy wrote "fixed it". This is what lets you decide whether the write-up can be trusted without redoing the work. Deduped, and capped at three. |
| `agy-error` | `⚠ <agy's error>` | agy's own error text, first line first. A long tail is truncated with a count; the full text is in the job log. |
| `watchdog` | `⚠ watchdog killed the run` | The print timeout plus 60s of grace elapsed and the plugin killed the process tree. The write-up, if any, is partial. |
| `wander` | `⚠ agy reported file changes but the working tree is unchanged` | agy said it wrote files and the repo disagrees — the writes most likely landed in `~/.gemini/antigravity-cli/scratch`. Only checked inside a git repo; outside one there is no tree to compare against. |
