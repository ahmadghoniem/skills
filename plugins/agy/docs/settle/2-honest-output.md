# agy settle list 2 of 3: honest output

Every item here is about what Claude Code is told when an agy run ends. The caller never
sees agy directly. It sees what `delegate.mjs` prints and the exit code in the task
notification, so any gap here turns into a wrong report to the user.

Lands after file 1, one commit per item, in the order below. J1 and K4 come first.

---

## J1. A timeout on agy 1.2.2 looks like a clean run (critical)

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

**Change.** Detect that stderr line. When present, print `⚠ agy hit the print timeout after
<N>s; the output is partial` and the resume line from F1, and record it on the job
(`timedOut: true`).

## K4. stderr is hidden whenever agy reports a status

**Why it is hidden.** Commit `3e0d115` on 2026-08-24 added stderr to the output, on purpose
only when there is no write-up and no status. That shape meant "agy never started": not
signed in, unknown flag, spawn failure. The commit's reasoning was that a run with a report
keeps its report as the output, so "a working-but-chatty run gains nothing". On agy 1.1.19
that held: stderr only carried startup failures. Of 122 job records, one has stderr stored.

**Why it is wrong now.** 1.1.28 moved two things onto stderr for runs that do have a status:
the timeout line above, and fatal errors, now prefixed with a stable `error:` marker. The
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
no write-up *and* no status. With an unknown model on 1.2.2, agy writes this to stderr:

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

**Change.** Delete the "no write-up and no status" condition. Show the whole stderr tail as ⚠
detail on every run where it is non-empty, with no filter: agy writes nothing to stderr on a
normal run, so there is no noise to hide. J1 builds on this.

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

- agy's own timeout (the J1 stderr line),
- the plugin's watchdog,
- a dropped connection or network error (agy status `ERROR` with a conversation id),
- a quota error.

Not for never-started runs, which have no conversation to continue.

## K1. `delegate.mjs` exits 0 on every finished run

**Story.** `delegate.mjs:250` returns 0 after printing, whatever happened. Only an exception
inside the wrapper exits 1. The task notification Claude receives therefore says exit 0 for a
never-started run, an agy error, a timeout and a watchdog kill alike. The reporting eval
replayed 37 unfinished runs: 0 exited non-zero.

**Change.** Exit non-zero when the run did not finish. Candidate: 1 for unfinished or failed,
0 for finished, even with tool errors. The ⚠ lines still carry the detail.

## K2. A run that never started is recorded as `done`

**Story.** The record is `failed` only when the watchdog killed agy, or when agy printed no
status and exited non-zero (`delegate.mjs:134`). An unknown model makes agy print status
`ERROR` and exit 1, so the record says `done`. `/agy:result --list` then shows it as done. The
reporting eval: 1 of 6 never-started runs recorded as failed.

**Change.** Record `failed` when agy did no work at all: status `ERROR` with no conversation id
and no tool steps.

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

## B2. Surface `denied_actions`

**Story.** agy 1.1.27 fixed headless runs silently skipping tool actions they were not allowed
to take. They now end with a notice and list the actions as `denied_actions` in the JSON output.

The plugin always runs agy with `--dangerously-skip-permissions` (see file 3, settled), so this
list should stay empty. URL fetching, which 1.1.28 put behind approval, ran without a prompt
under that flag on 1.2.2 (2026-09-13, `read_url_content`).

**Change.** A guard only. If `denied_actions` is ever non-empty, print it as a ⚠ line, since it
would mean the bypass stopped covering something. First confirm the field appears in
`stream-json` output.

## I2. Mark orphaned jobs

**Story.** A job record says `running` from creation until the wrapper writes the final record.
If the wrapper dies first, because the Claude session closed or a subagent's background task
was stopped (file 3, K5), the record says `running` forever. Three records from 2026-09-05 and
2026-09-07 are stuck. A bare `/agy:cancel` counts them and refuses: "Multiple running jobs".

**Change.** On read, treat a `running` record whose wrapper pid and agy pid are both gone as
`orphaned`. `isPidGone` already exists in `killtree.mjs`.

## K3. A short job id can match another repository's job

**Story.** Job ids end in a 4-character suffix, and commands accept the suffix alone.
`resolveJob` searches this repo first, then every repo. A suffix with no match here can resolve
to another repo's job, and `/agy:resume` then continues a conversation bound to that other
workspace while running from this one. Reproduced in the reporting eval.

**Change.** Search only this repo, unless a full job id is given.

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

**Change.** Count checkpoint steps. When there is at least one, print
`⚠ agy compacted its context N time(s) during this run; check the diff against the brief`.
Store `compactions` on the job record. Separately, test whether adding "If your context is
compacted, re-read this file before continuing" to the sidecar instruction raises the re-read rate,
before adopting it.

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
