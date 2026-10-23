# Reading a Cursor run's output

On a clean run, the output is Cursor's own write-up and nothing else. Status
tables, run durations, file lists, and token counts are omitted; repository
changes are directly inspectable via `git status`.

Relay the write-up as-is without summarizing.

## The ⚠ lines

Lines beginning `⚠` are the exceptions the plugin does surface — the ways a run
can be wrong while Cursor still calls it done. Three rules govern all of them:

1. **Never drop one.** They are the only part of the output that is not
   recoverable by looking at the repo yourself.
2. **Never fold two into one verdict.** Cursor's stop reason and the process exit
   code are independent facts that disagree in both directions. Each is allowed
   to fire alone.
3. **Never infer a pass or fail from them.** The plugin reports facts; a ⚠ line
   is information, not a judgement.

`delegate.mjs` exits 1 when the run did not finish. That is a fact about the run, not a
verdict on the work: whatever Cursor wrote before it stopped is still in the tree, and the ⚠
lines say why.

## What the plugin can emit

| id | Line | What it means |
| :--- | :--- | :--- |
| `stop-reason` | `⚠ stop reason: <reason>` | The `subtype` of Cursor's closing `result` event when it is not `success`, verbatim; `error` when that event sets `is_error`. `incomplete` means Cursor never sent a `result` event: the run was killed, crashed, or was refused before it started. |
| `exit` | `⚠ exit N` | The process exit code. Independent of the line above; a good report with a stray non-zero exit is still a good report. |
| `error-detail` | `⚠ error: <reason>` | Why the run stopped, in Cursor's words: the text of an error `result` event, or the end of stderr on a failing exit. This is where "not signed in", a rejected flag and a model the plan does not allow show up. Further lines are indented under the first. |
| `killed` | `⚠ run was killed before finishing (timeout or watchdog)` | The `--timeout` elapsed and the plugin killed the process tree. The write-up, if any, is partial. |
| `failed-commands` | `⚠ N commands exited non-zero — reported, not judged; Cursor may have meant them:` | Terminal commands that returned non-zero, each with its exit code and up to ten lines of output. This does **not** mean the job failed: a `grep` that matches nothing, a deliberately red test and a `command -v` probe all land here. It also catches a failed verification step under a clean stop reason. Report it and move on. |
| `resume` | `⚠ this run can be resumed where it stopped: /cursor:resume <id>` | The run ended before Cursor finished (the timeout, a dropped connection, a quota error) and Cursor had started the chat. Resuming keeps what Cursor already read and changed; a fresh dispatch starts from zero. Cursor may have finished the work before the error, so check the diff first: resume only if the work is missing, and prefer it to a new dispatch. |
| `wander` | `⚠ Cursor reported file changes but the working tree is unchanged` | The write-up says files were created or modified, and two `git status` readings taken either side of the run show no change. Read it as "the claim and the repo do not match". Only checked inside a git repo. |

## The update line

A line saying a newer Cursor CLI version is available follows the output at most once a
day. Ask the user whether to run `/cursor:update`; do not run it unasked.
