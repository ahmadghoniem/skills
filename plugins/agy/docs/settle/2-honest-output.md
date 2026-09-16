# agy settle list 2 of 3: honest output

Every item here is about what Claude Code is told when an agy run ends. The caller never
sees agy directly. It sees what `delegate.mjs` prints and the exit code in the task
notification, so any gap here turns into a wrong report to the user.

Lands after file 1, one commit per item. Landing order: K4, J1, K2, F1, K1, I2, K3, X1, B2,
B1, J3 (see the landing order section at the top of file 1). K4 lands before J1, since J1
detects a stderr line that K4 stops hiding. K2 lands before F1 and K1, since both of those
share K2's "did the run finish" rule through one `isUnfinished(job)` helper (see F1).

---

## K4. stderr is hidden whenever agy reports a status

**Why it is hidden.** Commit `3e0d115` on 2026-08-24 added stderr to the output, on purpose
only when there is no write-up and no status. That shape meant "agy never started": not
signed in, unknown flag, spawn failure. The commit's reasoning was that a run with a report
keeps its report as the output, so "a working-but-chatty run gains nothing". On agy 1.1.19
that held: stderr only carried startup failures. Of 122 job records, one has stderr stored.

**Why it is wrong now.** 1.1.28 moved two things onto stderr for runs that do have a status:
a timeout line (J1), and fatal errors, now prefixed with a stable `error:` marker. The
changelog also says headless runs print a note "when the response may be truncated".

**What 1.2.2 actually writes to stderr.** 20 runs since the update, 4 with stderr, and every
line mattered:

| Line | Runs |
| --- | --- |
| `[agy] print timeout after 1h0m0s with turn in progress; returning partial output` | 2 |
| `root agent idle; waiting for N background task(s) (bounded by --print-timeout)` | 1 |
| `terminating N background task(s) on exit` | 1 |
| `error: There was a network issue connecting to the server, please try ...` | 1 |

The two timeouts were real work runs on 2026-09-13, both with a one-hour timeout, and both lost
the network near the end (agy status `ERROR`, "no such host" after 6 attempts, exit 0). Claude saw
the network error but not that the hour had run out, and no resume line, although both have a
conversation id.

**How it works today, with an example.** `render.mjs:121` prints stderr only when agy returned
no write-up *and* no status (`saidNothing`). With an unknown model on 1.2.2, agy writes this to
stderr:

```
error: invalid model selection (--model "not-a-model" --effort ""): model not-a-model is not recognized ...
Available models:
  Gemini 3.8 Flash (High)
  ...
```

It also sends a `result` event with status `ERROR` and the same text in `error`. Because a status
exists, stderr is hidden, and the caller sees the `error` field instead:

```
⚠ agy status: ERROR (no write-up, 0 files changed)
⚠ exit 1
⚠ invalid model selection (--model "not-a-model" --effort ""): ...
  Available models:
  … 11 more lines (full text in the job log)
```

On a 1.2.2 timeout there is no `error` field, so the stderr line is the only record, and it is
hidden.

**No `error:` mechanism exists in the plugin.** Nothing in `scripts/` reads the `error:` prefix.
Filtering on it was only a proposal, now dropped, so there is no code to remove for it.

**Change.** Delete the "no write-up and no status" condition, and change the line text, since
"agy produced no result" is false once the line fires on runs that did produce a result:

```diff
-  const saidNothing = (job.summary == null || String(job.summary).trim() === '') && !status;
   const stderrTail = Array.isArray(job.stderrTail) ? job.stderrTail : [];
-  if (saidNothing && stderrTail.length > 0) {
+  if (stderrTail.length > 0) {
     out.push({
       id: 'stderr',
-      line: 'agy produced no result. Its stderr:',
+      line: 'agy wrote to stderr:',
       detail: [...stderrTail],
     });
   }
```

Update `contract.md:32`:

```diff
-| `stderr` | `⚠ agy produced no result. Its stderr:` | agy never started (unauthenticated, unknown `--model`, rejected flag, or spawn failure). Fires only when there is neither write-up nor status. The indented lines show the tail of stderr to indicate the fix: log in again, re-run `/agy:setup`, or wait. |
+| `stderr` | `⚠ agy wrote to stderr:` | Everything agy wrote to stderr (last 20 lines), on any run. agy is silent on stderr when nothing went wrong, so this carries startup failures (not signed in, unknown `--model`, rejected flag, spawn failure), its own timeout notice, background-task notes and network errors. Read it before the `error` line: on a 1.2.2 timeout it is the only record. |
```

and `README.md:72`'s row the same way.

Show the whole stderr tail as ⚠ detail on every run where it is non-empty, with no filter: agy
writes nothing to stderr on a normal run, so there is no noise to hide. "Whole stderr" means
the last `STDERR_TAIL_LINES = 20` lines (`agy.mjs:364`, `:445`); the unknown-model message
above is 16 lines, so it fits today. Leave the constant.

Delete tests `tests/render.test.mjs:250-261` ("stays silent when agy DID produce a write-up")
and `:263-276` ("stays silent when agy reported a status"); they assert the behaviour this
item removes. Update the expected string in the remaining stderr test at `:245` to the new
line text.

**Accepted consequence.** On an unknown model the caller now sees the model list twice, once
under `stderr` (up to 20 lines) and once truncated under `agy-error` (first line plus 4). No
filter is added to avoid it; the owner asked for none.

**Papercuts.** `stderr` is a `warn` detected papercut (`papercuts.mjs:43`). After this change
every run with any stderr output files a papercut row, including lines like
`root agent idle; waiting for N background task(s)` and `terminating N background task(s) on
exit`. No change requested here; noted so `/agy:kaizen` output is not misread later.

J1 builds on this.

## J1. A timeout on agy 1.2.2 looks like a clean run

**Story.** Up to agy 1.1.27, when `--print-timeout` expired agy ended with status `ERROR`,
error "timeout waiting for response", and exit 1. The plugin printed three ⚠ lines. agy
1.1.28 changed this: it now returns whatever partial output exists, with status `SUCCESS` and
exit 0. The only sign of a timeout is one stderr line:

```
[agy] print timeout after 15s with turn in progress; returning partial output
```

Verified twice on agy 1.2.2: on 2026-09-12 with a 12 s timeout, and on 2026-09-13 with a
15 s timeout. Both exited 0 with status `SUCCESS` and an empty response.

**What the caller sees.** `(agy returned no report)`, or the partial text alone, with no ⚠
line. In the caller eval, Claude told the user agy "did nothing" and never said it timed out.

**Change.** Detect the line by regex on each stderr line:
`/^\[agy\] print timeout after (\S+) with turn in progress/`. `summariseEvents` only sees
stdout events; stderr is `result.stderr` in `delegate.mjs:106-127`, so detect it there, after
`summariseEvents` runs:

```js
const timeoutLine = result.stderr.find((l) => /^\[agy\] print timeout after \S+ with turn in progress/.test(l));
const timedOut = Boolean(timeoutLine);
const timedOutAfter = timeoutLine ? /after (\S+)/.exec(timeoutLine)[1] : undefined;
```

Store `timedOut: timedOut || undefined` and `timedOutAfter` on the job record (add both to the
`JobRecord` typedef in `jobs.mjs`).

Print agy's own token verbatim, since it is a Go duration (`15s`, `1h0m0s`), not a plain
second count: `⚠ agy hit its print timeout after 1h0m0s; the output is partial`. Add
`"timeout"` to `WARNING_IDS` between `"watchdog"` and `"resume"` (so the resume line follows
it), and the anomaly:

```js
{ id: 'timeout', line: `agy hit its print timeout after ${job.timedOutAfter ?? 'its limit'}; the output is partial` }
```

when `job.timedOut`. Add the matching row to `contract.md` in the same position
(`tests/contract.test.mjs` enforces order).

Add `timeout: { severity: 'warn' }` to `DETECTED_WARNINGS` (`papercuts.mjs:41-47`), so a 1.2.2
timeout reaches the friction log; without it, `/agy:kaizen` never learns about these runs.

The raw stderr line also appears under K4's `stderr` block once K4 lands. Accept the
duplication: K4 shows the whole tail, and this line is a parsed, readable summary of one entry
in it.

## K2. A run that never started is recorded as `failed`

**Story.** The record is `failed` only when the watchdog killed agy, or when agy printed no
status and exited non-zero (`delegate.mjs:134`). An unknown model makes agy print status
`ERROR` and exit 1, so the record still says `done`. `/agy:result --list` then shows it as
done. The reporting eval: 1 of 6 never-started runs recorded as failed.

**Change.** Record `failed` when agy did no work at all: status `ERROR` with no conversation
id.

```js
const failed =
  (summary.status == null && result.exitCode !== 0) ||
  (String(summary.status).toUpperCase() === 'ERROR' && !summary.conversationId);
```

Keep the existing first clause; the reporting eval's `spawn-failed` class (exit 127) relies on
it.

No `toolCalls` field is added to the job record for this rule. Measured across all 137
recorded runs in `evals/fixtures/replay` (see the table under F1): every never-started run
(5 of them) has no conversation id, no tool steps, status `ERROR` and exit 1, while every other
`ERROR` class has a conversation id. The `!conversationId` half of the rule above already
separates never-started runs from every other `ERROR` outcome; a stored tool-call count would
not narrow that further, and the orchestrator has no use for agy's tool count elsewhere.

## F1. Offer resume on every ending that can be resumed

**Story.** When a run ends early but agy has a conversation id, `/agy:resume <job>` continues
that same agy conversation: agy keeps what it read, what it tried and what it already changed.
A fresh dispatch starts from zero.

The plugin prints `⚠ this run can be resumed where it stopped: /agy:resume <job>` only when
its own watchdog killed agy (`render.mjs:176`). The watchdog fires at the print timeout plus
60 s. agy stops itself at the print timeout, 60 s earlier, so the watchdog almost never gets
the chance. It fired twice in 122 runs.

**The numbers.** 31 recorded runs ended early with a conversation id: agy timeouts, dropped
streams, quota errors and the two watchdog kills. The hint appeared on 2: the watchdog kills.

**A real case.** On 2026-09-06 job `repo-c-users-...-fdp2` worked for 15 minutes, changed two
files, and hit agy's timeout. The caller saw:

```
⚠ agy status: ERROR (no write-up, 2 files changed)
⚠ exit 1
⚠ 1 tool call failed during the run — reported, not judged:
  run_command: context canceled
⚠ timeout waiting for response
```

Nothing says the run can continue. Claude's options are to tell the user it failed, or to send
the brief again as a new job. A new job re-reads the repo, redoes 15 minutes of work, and meets
the two half-finished files it does not remember writing. With the hint, Claude would run
`/agy:resume fdp2 "continue"` and agy would pick up where it stopped.

**Design flaw.** The hint is tied to who stopped the run (the plugin's watchdog) instead of
whether the run can continue (it ended unfinished and has a conversation id).

**Change.** Print the resume line whenever the run is unfinished and has a conversation id,
whatever stopped it:

```js
if (isUnfinished(job) && job.conversationId) { ... }
```

`isUnfinished(job)` is one shared helper, kept in `render.mjs`, used by this resume line, by
K1's exit code, and by the watchdog/timeout lines. It replaces three divergent definitions of
"unfinished" that those three places used separately, and it does not add any new state to the
job record:

```js
export function isUnfinished(job) {
  return (
    job.status === 'failed' ||
    job.status === 'cancelled' ||
    job.status === 'orphaned' ||
    job.killed ||
    job.timedOut ||
    String(job.agyStatus ?? '').toUpperCase() === 'ERROR'
  );
}
```

The resume line does not exclude `job.status === 'failed'`. A watchdog-killed run is marked
`failed` (`delegate.mjs:135`) and still has a conversation id worth resuming, so excluding
`failed` runs would remove the resume offer from exactly the case this item exists to fix.
`job.conversationId` alone is enough to exclude never-started runs: measured across the 137
replayed runs (see the table below), every never-started run has no conversation id (K2), so
it is already excluded without a separate `status !== 'failed'` check.

This covers:

- agy's own timeout (the J1 stderr line),
- the plugin's watchdog,
- a dropped connection or network error (agy status `ERROR` with a conversation id),
- a quota error.

Not for never-started runs, which have no conversation to continue.

Update `contract.md:36`:

```diff
-| `resume` | `⚠ this run can be resumed where it stopped: /agy:resume <id>` | Fires alongside the watchdog line when the conversation id was captured on the `init` event. Re-dispatching the brief instead is an alternative if the run diverged before the timeout. |
+| `resume` | `⚠ this run can be resumed where it stopped: /agy:resume <id>` | The run ended before agy finished (agy's timeout, the watchdog, a dropped connection, a quota error) and agy kept the conversation. Resuming keeps what agy already read and changed; a fresh dispatch starts from zero. Prefer resume unless the run had clearly gone wrong before it stopped. |
```

`agyStatus ERROR` includes runs whose work landed (B1's runs where the refusal was retried,
and the `error-but-succeeded.json` fixture). Offering resume on those is harmless: the line is
an offer, and the contract text says so.

**Not extended further.** The resume offer is not widened past what the code above does. A
wider rule, for example offering resume for some extra margin past the print timeout plus the
60 s watchdog grace, was considered and dropped: by that point any provider-side context cache
for the conversation is cold, so resuming an hour-long run is charged at full price, and a
fresh dispatch is usually the better option. The code above already covers every case worth
the offer.

### Measured, from the replayed fixtures

137 recorded runs replayed from `evals/fixtures/replay`, by class:

| Class | Runs | Exits 1 under K1 |
| --- | --- | --- |
| clean | 60 | no |
| clean-with-tool-errors | 29 | no |
| timeout | 18 | yes |
| stream-drop | 11 | yes |
| refused-write | 6 | yes |
| never-started | 5 | yes |
| watchdog | 2 | yes |
| quota | 2 | yes |
| other | 2 | yes |
| spawn-failed | 1 | yes |

Every class except `clean` and `clean-with-tool-errors` exits 1 under K1's rule. The 5
never-started runs have no conversation id, which is what K2 uses to record them as `failed`.

## K1. `delegate.mjs` exits 0 on every finished run

**Story.** `delegate.mjs:250` returns 0 after printing, whatever happened. Only an exception
inside the wrapper exits 1. The task notification Claude receives therefore says exit 0 for a
never-started run, an agy error, a timeout and a watchdog kill alike. The reporting eval
replayed 37 unfinished runs: 0 exited non-zero.

**Change.** Exit non-zero when the run did not finish, using the same `isUnfinished(job)`
helper as F1:

```diff
   const finished = readJob(root, jobId);
   if (finished) process.stdout.write(renderResult(finished));
-  return 0;
+  return finished && isUnfinished(finished) ? 1 : 0;
```

`resume.mjs` returns `delegateMain`'s code, so it inherits this. A clean run has no `ERROR`, no
kill and no timeout, so it stays exit 0; a run with tool errors only also stays 0, since
`isUnfinished` does not look at tool errors.

This exits 1 on agy status `ERROR` even when the work landed. Measured across the 137 replayed
runs (see the table under F1), 8 finished with a write-up and still reported status `ERROR`
(6 `refused-write`, 2 `other`). Accepted deliberately: the rule over-reports on 8 of 137 runs
and never under-reports, and splitting those 8 out further would need a signal the plugin does
not have.

Add to `commands/delegate.md` (Reading the output section): "A non-zero exit from
`delegate.mjs` means the run did not finish, not that agy's work is wrong. Read the ⚠ lines.
If a `/agy:resume` line is offered, resume rather than re-dispatching."

Also replace the guidance at `commands/delegate.md:73-74`, "review the diff yourself before
telling the user it is done", which gives no scope and has led to callers running
whole-monorepo test suites after a slice and chasing pre-existing failures. Replace it with:
"After a job that changed code, read `git diff` for the files the brief named and run the
verification command the brief gave. Do not run the repository's whole test suite over a
slice."

Add a rule to `skills/output-contract/contract.md` after rule 3: "`delegate.mjs` exits 1 when
the run did not finish. That is a fact about the run, not a verdict on the work; the ⚠ lines
say why."

## I2. Mark orphaned jobs

**Story.** A job record says `running` from creation until the wrapper writes the final record.
If the wrapper dies first, because the Claude session closed or a subagent's background task
was stopped (file 3, K5), the record says `running` forever. Three records from 2026-09-05 and
2026-09-07 are stuck. A bare `/agy:cancel` counts them and refuses: "Multiple running jobs".

**Change.** On read, treat a `running` record as `orphaned` only when its pids are present and
gone: `typeof job.pid === 'number' && isPidGone(job.pid)` and (`job.cliPid` is not a number or
`isPidGone(job.cliPid)`). `createJob` (`jobs.mjs:129-146`) writes `status: 'running'` with no
`pid` yet; `pid` arrives in `runAndRecord`'s first `updateJob` (`delegate.mjs:84-92`) and
`cliPid` on spawn, so a record read in that window has no pids and must not be marked
orphaned. Do not copy `cancel.mjs`'s `allPidsAlreadyGone`, which treats "no pid bits" as gone;
that reading is wrong here. `isPidGone` already exists in `killtree.mjs`.

Apply the check in `readJobFile` (`jobs.mjs:212-222`) so every reader (`listJobs`,
`resolveJob`, `readJob`, `findRunningJobs`) sees it. Add `'orphaned'` to `JobStatus`
(`jobs.mjs:16`).

This falls out of readers without more code: `findRunningJobs` excludes orphans, so a bare
`/agy:cancel` no longer refuses with "Multiple running jobs"; `mostRecentFinishedJob`
(`status !== 'running'`) includes them; `result.mjs:40` no longer prints "still running" for
them; `cancelJob` on an orphan takes the `job.status !== 'running'` branch and `cancel.mjs`
prints "was not running (already orphaned)".

Add "orphaned" to `commands/result.md:13` ("running and orphaned jobs are included"), and to
`commands/cancel.md`: "A job whose processes are already gone is reported as orphaned; nothing
is killed."

## K3. A short job id can match another repository's job

**Story.** Job ids end in a 4-character suffix, and commands accept the suffix alone.
`resolveJob` searches this repo first, then every repo. A suffix with no match here can resolve
to another repo's job, and `/agy:resume` then continues a conversation bound to that other
workspace while running from this one. Reproduced in the reporting eval.

**Change.** `jobs.mjs:241` `allJobs()`: delete it, it becomes unused. `jobs.mjs:261`
`resolveJob`: delete the last line `return matchQuery(allJobs(), q);` and return `localHit`
instead. Keep `locateJobFile`'s cross-repo scan (`jobs.mjs:185-193`): it only matches a full
`<id>.json` file name, which is the "unless a full job id is given" case that stays, and
`tests/jobs.test.mjs:180-185` depends on it for `updateJob`. `tests/jobs.test.mjs:60-85` keep
passing unchanged (single repo).

Update `commands/result.md:15` and `commands/cancel.md:9`: "Job ids resolve by full name,
unique prefix, or the 4-char suffix alone" → append ", within this repository".

## X1. Say when agy compacted its context

**Story.** When a run's context grows large, agy replaces the conversation so far with a summary
and carries on. Its own note to the model says it has "lost access to the full conversation
history". Exact file contents, errors and earlier decisions survive only as far as the summary
kept them. agy's config sets the threshold at 140k tokens; in practice the switch showed up at
222k to 262k in one model call across plugin runs, and at 344k in a live 1.2.2 test (file 3, I3).

The caller is never told. A run that compacted twice and a run that never did print the same
write-up. That matters when Claude reviews the diff: work after a compaction is where agy is most
likely to redo something or drift from the brief. After 20 of the 39 mid-run compactions, agy never
re-read the brief file.

**How to detect it.** `stream-json` emits a step with `step_type: "checkpoint"` for each compaction.
Confirmed in the live test.

**Change.** Count a `checkpoint` step only after the first `tool` or `agent_response` step. All
five committed fixtures carry exactly one `checkpoint` step, at `step_index: 1`, directly after
the `user_input` step and before any tool call or model turn (verified in
`tests/fixtures/agy-events/read-and-command.ndjson:3`, and at line 3 of `add-dir-works`,
`permission-denied`, `scratch-wander`, `scratch-wander-in-git-repo`). A naive count of every
`checkpoint` step would print the warning on every clean run, including the offline eval's
"Clean run is quiet" check (52 of 52 today).

```js
let sawWork = false;
let compactions = 0;
// inside the step_update branch, before the `if (su.step_type === 'tool')` block:
if (su.step_type === 'tool' || su.step_type === 'agent_response') sawWork = true;
else if (su.step_type === 'checkpoint' && sawWork) compactions += 1;
```

Add `compactions` to the summary, the job record and its typedef. Add `"compaction"` to
`WARNING_IDS` after `"tool-errors"` and before `"agy-error"`, with the anomaly:

```js
{ id: 'compaction', line: `agy compacted its context ${n} time${n === 1 ? '' : 's'} during this run; check the diff against the brief` }
```

when `n > 0`. Add the matching row to `contract.md` in the same position. Add a unit test
asserting `compactions === 0` for `read-and-command.ndjson`. This is not a papercut: it is
information about the run, not friction, so it does not go through `papercuts.mjs`.
Separately, test whether adding "If your context is compacted, re-read this file before
continuing" to the sidecar instruction raises the re-read rate, before adopting it; that
experiment stays untested and unadopted.

## B2. Surface `denied_actions`

**Story.** agy 1.1.27 fixed headless runs silently skipping tool actions they were not allowed
to take. They now end with a notice and list the actions as `denied_actions` in the JSON output.

The plugin always runs agy with `--dangerously-skip-permissions` (see file 3, settled), so this
list should stay empty. URL fetching, which 1.1.28 put behind approval, ran without a prompt
under that flag on 1.2.2 (2026-09-13, `read_url_content`).

**Change.** A guard only. No committed fixture contains `denied_actions`
(`rg denied_actions tests/fixtures` finds nothing). In the `result` branch of
`summariseEvents`: `if (Array.isArray(r.denied_actions) && r.denied_actions.length)
deniedActions = r.denied_actions;`, store it on the record, add `"denied"` to `WARNING_IDS`
(after `"compaction"`) and its contract row. If the field never appears in the `stream-json`
envelope this code is dead but harmless.

After this and X1, `WARNING_IDS` order is: `agy-status, exit, stderr, tool-errors,
compaction, denied, agy-error, watchdog, timeout, resume`. `tests/contract.test.mjs` checks
`contract.md`'s rows match this order.

## B1. Refused artifact writes

**Story.** agy's file-writing tool has an "artifact" mode for agy's own documents, which must
live in its conversation folder (`~/.gemini/.../brain/<id>/`). agy's model sometimes sets that
mode for an ordinary file. The tool refuses with "is not a valid artifact path", and the model
retries with a normal write or a shell command, which works.

**Corrected numbers.** 17 recorded runs contain this refusal:

- 6, all on 2026-08-24, ended with agy status `ERROR`, so the refusal became the headline error
  on a run that finished its task.
- 11, from 2026-08-26 onwards, ended with status `SUCCESS`. The refusal shows as one line under
  `⚠ 1 tool call failed during the run`.

The earlier "11 records, agy reports ERROR" was wrong. Since late August agy no longer fails
the run over it.

**Why it still matters, slightly.** A finished run carries a ⚠ line about a failed write, which
can make Claude doubt a run that worked or re-check the file.

**Change.** Low priority. Retest on 1.2.2. If it still appears, leave it listed. A refusal that
agy recovered from is still a fact, but the line could say the write was retried.

## J3. Watch for fewer dropped connections

agy 1.1.28 and 1.2.1 retry 502, 503, 504, 429 and interrupted streams inside agy. Eight recorded
failures were "stream was interrupted" or "network issue". No code change. Check again when the
reporting eval fixtures are rebuilt.

---

## Eval results that track this file

Reporting eval, offline, 119 recorded runs replayed through the real scripts, run 2026-09-13:

| Check | Result |
| --- | --- |
| Unfinished run raises a warning | 36 of 37 (the miss is the 1.2.2 timeout, J1) |
| Resumable run offers `/agy:resume` | 2 of 31 (F1) |
| Unfinished run exits non-zero | 0 of 37 (K1) |
| Never-started run recorded as failed | 1 of 6 (K2) |
| Clean run is quiet | 52 of 52 |
| Conversation id saved | 113 of 113 |
| Bare cancel with one orphan | refused (I2) |
| Short suffix stays in this repo | no (K3) |

Run with `npm run eval` from `plugins/agy`. Rebuild fixtures after new runs with
`node evals/build-fixtures.mjs`.
