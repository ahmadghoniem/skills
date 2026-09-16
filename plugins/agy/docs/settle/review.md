# Review of the settle plan

Reviewed against `agy/settle` at `ca9e032` (identical to `origin/agy/settle` and to this
checkout's HEAD). `npm test` in `plugins/agy` passes: 8 files, 139 tests. The P1 diff applies
cleanly to HEAD (`git apply --check` exit 0). Live agy and the live evals were not run. The
offline reporting eval was not run either: its fixtures are not committed
(`evals/.gitignore` lists `fixtures/replay/`).

## Landing order and structural changes

Land file 1, then file 2, then file 3, one commit per item, with these changes:

1. **K5 is the first commit of file 3, and it deletes `agents/agy-runner.md`.** The owner has
   fixed "retire the runner". G1, M1 (file 1) and D3 all edit or commit that same file. Do not
   edit it in file 1. In file 1, G1 becomes a no-op (mark it "superseded by K5") and M1 touches
   only `commands/delegate.md`. D3 is dropped. The runner's brief anatomy moves into
   `commands/delegate.md` as part of K5 (text below, under K5).
2. **File 2 order: K4, J1, K2, F1, K1, I2, K3, X1, B2, B1, J3.** J1 needs K4's new stderr line,
   K2 needs to land before F1 and K1 because both use "did the run finish", and F1 and K1 must
   share one definition of "unfinished" (given under F1). B1 and J3 have no code.
3. **Two items are called M1.** File 1 M1 (remove the AskUserQuestion prompt) and file 3 M1
   (effort for every model). This review calls the file 3 one **M1b**. Rename it in the file.
4. **The `--print-models` mode of `setup.mjs` needs a decision before file 1 M1 lands.** Its
   only documented caller is the AskUserQuestion flow that M1 removes (`setup.mjs:19-20`,
   `commands/delegate.md:35`). Keep it and repurpose it for M1b's table (see M1b); do not delete
   it in file 1.
5. **A4 breaks one offline eval check and X1 breaks another unless adjusted.** See A4 and X1.

---

## A1. Remove the wander warning

Severity: `fix`. The item is right; the list of things to delete is incomplete.

Evidence, all verified at HEAD:

- `scripts/lib/parse.mjs:72` `SCRATCH_RE`, `:81` `claimsFileChanges`, `:101` `toolParamPaths`
  (only used to feed `scratchPaths`, `parse.mjs:188-193`), `:159-161` and `:239-241`
  `scratchPaths`, `writeTargets`, `claimedFileChanges`. The plan's `parse.mjs:81` reference is
  correct.
- `scripts/lib/render.mjs:25` `WANDER_WARNING`, `:68` `"wander"` in `WARNING_IDS`, `:183-187`
  the anomaly, `:46` `claimedFileChanges` in the typedef.
- `scripts/lib/papercuts.mjs:42` `wander` in `DETECTED_WARNINGS`, `:145-154` the `wander`
  branch of `evidenceFor`.
- `scripts/delegate.mjs:148` `claimedFileChanges`, `:172-173` `writeTargets`, `scratchPaths`.
- `scripts/lib/jobs.mjs:45` `claimedFileChanges` in the `JobRecord` typedef.
- `skills/output-contract/contract.md:37` the `wander` row. `tests/contract.test.mjs` fails
  unless the row and the `WARNING_IDS` entry go together.
- `README.md:74` the wander row in the warnings table.
- Tests: `tests/render.test.mjs:2` imports `WANDER_WARNING`; `:101-122` two wander tests;
  `:95`, `:107`, `:119`, `:160` set `claimedFileChanges`. `tests/parse.test.mjs:3` imports
  `claimsFileChanges` and `toolParamPaths`; `:43-48` `toolParamPaths` test; `:50-58`
  `claimsFileChanges` tests; `:84-86`, `:113-127`, `:144` assert `claimedFileChanges`,
  `writeTargets`, `scratchPaths`. `tests/papercuts.test.mjs:64-65` set `writeTargets` and
  `scratchPaths`, `:68-79` "turns a wander into one cut", `:122` a cut with `warningId: 'wander'`.

Keep the fixtures `tests/fixtures/agy-events/scratch-wander*.ndjson`: `tests/parse.test.mjs:128-138`
uses them for the `run_command` exit-code assertion, which is unrelated to wander. Delete the
wander assertions and keep the rest of those tests.

Also delete `toolParamPaths` and `SCRATCH_RE`; nothing else reads them (`rg toolParamPaths
scripts/` finds only `parse.mjs`).

## A2. Remove the git repository check and `--no-git-check`

Severity: `ok`, one addition.

`delegate.mjs:221` is correct (`if (!(await isRepo(process.cwd())) && !flags.noGitCheck)`).
Also delete: `delegate.mjs:41` (`noGitCheck` parse), `:52`, `:74` (`isRepo(root)` inside
`runAndRecord`, which feeds `gitRepo`), `:89` and `:146` (`gitRepo` in the record),
`resume.mjs:59-61` (`--no-git-check` rebuild), `commands/delegate.md:3` and `:65`,
`README.md:50`, `jobs.mjs:42` (`gitRepo` typedef), `render.mjs:40` (`gitRepo` typedef),
`render.mjs:83` (`if (job.gitRepo !== false)`, goes with A4).

Keep `tests/args.test.mjs:93` (`parseArgv(['--no-git-check'], ['git-check'])`). It tests the
parser's `--no-` negation with an arbitrary flag name, not the feature.

## A3. Remove the dirty-tree warning

Severity: `ok`. `delegate.mjs:230` is correct. `isDirty` is only called there.

## A4. Remove the before/after porcelain snapshots

Severity: `fix`. Correct, but the contract row, the render tests and one eval check are not
listed.

- `render.mjs:79` `statusContext` is the right function. After the change it returns
  ` (write-up present)` or ` (no write-up)`. Update `skills/output-contract/contract.md:30`:

```diff
-| `agy-status` | `⚠ agy status: <status> (write-up present, N files changed)` | agy's own verdict, verbatim. Not a pass/fail: agy can report `ERROR` on runs that worked and `SUCCESS` on runs that did not. The parenthetical reports whether a write-up exists and the file count from before and after `git status --porcelain` snapshots. The file count is omitted outside a git repo. |
+| `agy-status` | `⚠ agy status: <status> (write-up present)` | agy's own verdict, verbatim. Not a pass/fail: agy can report `ERROR` on runs that worked and `SUCCESS` on runs that did not. The parenthetical says only whether agy returned a write-up. Check `git diff` yourself for what changed. |
```

- `contract.md:16-18`, rule 2, names "the state of the working tree" as one of the three
  independent facts. After A4 the plugin does not report the tree. Replace:

```diff
-2. **Never fold two into one verdict.** agy's own status, the process exit code,
-   and the state of the working tree are independent facts that disagree in both
-   directions. Each is allowed to fire alone.
+2. **Never fold two into one verdict.** agy's own status, the process exit code,
+   and what agy wrote to stderr are independent facts that disagree in both
+   directions. Each is allowed to fire alone.
```

- `render.mjs:4-6` header comment says "working tree modifications remain separate facts".
  Drop that phrase.
- Tests to rewrite: `tests/render.test.mjs:9-10` (`gitRepo`, `gitFiles` in `base`), `:44-64`
  (the two file-count tests: "measures the ERROR" and "singularises one file"), `:91`, `:106`,
  `:118`, `:157-158`, `:166`, `:175-176`.
- `scripts/lib/git.mjs`: delete everything except `repoRoot` and its `run` import
  (`parsePorcelain`, `porcelainLetter`, `porcelain`, `isDirty`, `porcelainDelta`, the
  `GitFile` typedef). `render.mjs:29-33` has a second `GitFile` typedef; delete it too.
- `jobs.mjs:43-44` `gitBefore`, `gitFiles` typedef lines.
- **Eval:** `evals/reporting.eval.mjs:110-128` `scenarioParallel` grades
  `j?.gitFiles?.length` (check `parallel`, "Parallel jobs count only their own files"). With
  `gitFiles` gone it fails forever. Delete the `parallel` check (line 47) and the scenario, and
  its call site.

## A5. Drop `filesChanged` and the calls-per-file check

Severity: `fix`. Two sites are missing from the list.

Verified sites: `papercuts.mjs:63` (typedef) and `:188`; `papercut.mjs:85`; `kaizen.mjs:52-55`
(the `calls / files` bit in `line()`); `commands/kaizen.md:26-29` (covered by the P1 diff);
`delegate.mjs:170`. Missing from the plan:

- `commands/papercut.md:24`: "the run's model, conversation and file count are filled in" →
  "the run's model and conversation are filled in".
- `tests/papercuts.test.mjs:61` (`filesChanged: 0` in ctx) and `:78`
  (`expect(cuts[0].filesChanged).toBe(0)`).

In `kaizen.mjs:52-55` keep `toolCalls`: `bits.push(`${cut.toolCalls} calls`)`.

## A6. Keep `repoRoot`

Severity: `ok`. `git.mjs:19-26` falls back to `cwd` on non-zero exit, as described. After A2 to
A5 the only callers of `git.mjs` are `repoRoot` in `delegate.mjs`, `resume.mjs`, `result.mjs`,
`cancel.mjs`, `papercut.mjs`.

## G1. Delete the pre-read mandate in the runner prompt

Severity: `edited in review`. `agy-runner.md:25-33` is the right span. Do not implement it as
an edit; K5 deletes the file. Nothing in `commands/delegate.md` asks Claude to pre-read
(`delegate.md:11-13` already says the opposite), so no delegate.md change is needed for G1.

## M1 (file 1). Remove the AskUserQuestion model prompt

Severity: `fix`.

`commands/delegate.md:27-42` is the right span; `agy-runner.md:67-69` too, but that file is
deleted in K5. Additional edits:

- `commands/delegate.md:4` `allowed-tools`: remove `AskUserQuestion`. (C2 later adds `Write`.)
- `commands/delegate.md:21-23` is wrong today: it says the id is resolved "from the live
  `agy models` list". `resolveDefaultModel` (`agy.mjs:330-338`) reads only the cache. Replace
  lines 19-42 with:

```markdown
## Model and effort

Omit `--model`. The plugin picks the newest **flash** id from the cached `agy models`
list at the `--effort` you pass (`medium` if you pass none). Pass a model only when the
user names one. Never invent an id; the ids agy accepts are listed below.
```

  (M1b appends the model table under that heading.)

- `README.md:42` "Claude prompts for a model only when requested in the prompt." → delete the
  sentence.
- `setup.mjs:19-20` docstring ("for `/agy:delegate` to feed into AskUserQuestion"): reword
  when M1b repurposes the mode. Do not delete the mode in file 1.

## P1. Remove the `orchestrator` papercut source

Severity: `ok`, one polish.

The diff applies cleanly to HEAD and matches the described change. `git apply --check` was run
against the whole tree from `plugins/agy`, so the `README.md` hunk targets
`plugins/agy/README.md`, which is correct. The `commands/kaizen.md` hunk deletes lines 26-29
and so also does the `commands/kaizen.md` half of A5.

Polish: `CHANGELOG.md:32-35` (Unreleased) still advertises the `orchestrator` source:
"writes the two rows the plugin cannot observe: `narrated` … and `orchestrator` …". The
feature never shipped, so edit that entry to describe `narrated` only.

---

## K4. Show stderr on every run where it is non-empty

Severity: `fix`. `render.mjs:121` is correct (`saidNothing`). The line text and the tests are
not mentioned.

- The ⚠ line reads `agy produced no result. Its stderr:`. That is false once the line fires on
  runs that did produce a result. New line: `agy wrote to stderr:`. Code:

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

- `contract.md:32` row:

```diff
-| `stderr` | `⚠ agy produced no result. Its stderr:` | agy never started (unauthenticated, unknown `--model`, rejected flag, or spawn failure). Fires only when there is neither write-up nor status. The indented lines show the tail of stderr to indicate the fix: log in again, re-run `/agy:setup`, or wait. |
+| `stderr` | `⚠ agy wrote to stderr:` | Everything agy wrote to stderr (last 20 lines), on any run. agy is silent on stderr when nothing went wrong, so this carries startup failures (not signed in, unknown `--model`, rejected flag, spawn failure), its own timeout notice, background-task notes and network errors. Read it before the `error` line: on a 1.2.2 timeout it is the only record. |
```

- `README.md:72` row: same rewording.
- Tests `tests/render.test.mjs:233-288`: the first and fourth tests keep passing with the new
  line text (change the expected string at `:245`). Delete "stays silent when agy DID produce a
  write-up" (`:250-261`) and "stays silent when agy reported a status" (`:263-276`); they
  assert the behaviour K4 removes.
- "Whole stderr" means the last `STDERR_TAIL_LINES = 20` lines (`agy.mjs:364`, `:445`). The
  unknown-model message in the plan is 16 lines, so it fits. Leave the constant.
- Consequence to accept, not fix: on an unknown model the caller now sees the model list twice,
  once under `stderr` (up to 20 lines) and once truncated under `agy-error` (first line plus 4).
  The owner asked for no filter.
- Papercuts: `stderr` is a `warn` detected papercut (`papercuts.mjs:43`). After K4 every run
  with any stderr files a row, including `root agent idle; waiting for N background task(s)` and
  `terminating N background task(s) on exit`. No change requested; noting it so `/agy:kaizen`
  output is not misread later.

## J1. Detect agy's own timeout

Severity: `fix`. Two details are wrong or missing.

1. **The number is a Go duration, not seconds.** The plan's own examples show `after 15s` and
   `after 1h0m0s`. Print agy's token verbatim: `⚠ agy hit its print timeout after 1h0m0s; the
   output is partial`. Regex on each stderr line:
   `/^\[agy\] print timeout after (\S+) with turn in progress/`.
2. **Where it is detected.** `summariseEvents` sees only stdout events. stderr is
   `result.stderr` in `delegate.mjs:106-127`. Add after `summariseEvents`:

```js
const timeoutLine = result.stderr.find((l) => /^\[agy\] print timeout after \S+ with turn in progress/.test(l));
const timedOut = Boolean(timeoutLine);
const timedOutAfter = timeoutLine ? /after (\S+)/.exec(timeoutLine)[1] : undefined;
```

   Store `timedOut: timedOut || undefined, timedOutAfter` on the job (add both to the
   `JobRecord` typedef in `jobs.mjs`).
3. **Renderer and registry.** Add `"timeout"` to `WARNING_IDS` between `"watchdog"` and
   `"resume"` (so the resume line follows it), add the anomaly
   `{ id: 'timeout', line: `agy hit its print timeout after ${job.timedOutAfter ?? 'its limit'}; the output is partial` }`
   when `job.timedOut`, and add the matching row to `contract.md` in the same position.
   `tests/contract.test.mjs` enforces order.
4. **Papercuts.** Add `timeout: { severity: 'warn' }` to `DETECTED_WARNINGS`
   (`papercuts.mjs:41-47`). The plan is silent; without it a 1.2.2 timeout never reaches the
   friction log, which is the opposite of the plan's intent.
5. The raw stderr line will also appear under the K4 `stderr` block. Accept the duplication.

## K2. Record never-started runs as `failed`

Severity: `blocks` as written: the data it needs is not on the job record.

`delegate.mjs:134` is correct. The new rule is "status `ERROR` with no conversation id and no
tool steps". `toolCalls` exists on the summary (`parse.mjs:155`) but is never written to the
job record (`delegate.mjs:136-154` does not include it; `jobs.mjs` typedef has no field). Add
`toolCalls: summary.toolCalls` to the record and typedef. Then:

```js
const neverStarted =
  (summary.status == null && result.exitCode !== 0) ||
  (String(summary.status).toUpperCase() === 'ERROR' && !summary.conversationId && summary.toolCalls === 0);
```

Keep the existing first clause; the reporting eval's `spawn-failed` class (exit 127) relies on it.

## F1. Offer resume on every ending that can be resumed

Severity: `fix`. Needs one shared definition with K1, and the contract row rewrite.

`render.mjs:176` is correct. Put one helper in `render.mjs` and use it for the resume line,
for K1's exit code and for the watchdog/timeout lines:

```js
/** The run stopped before agy finished the task. Tool errors alone do not count. */
export function isUnfinished(job) {
  if (job.status === 'failed' || job.status === 'orphaned' || job.status === 'cancelled') return true;
  if (job.killed || job.timedOut) return true;
  return String(job.agyStatus ?? '').toUpperCase() === 'ERROR';
}
```

Resume line: `if (isUnfinished(job) && job.conversationId && job.status !== 'failed')`.
The `status !== 'failed'` clause is what excludes K2's never-started runs; do not rely on the
conversation id being absent (see "could not verify").

`contract.md:36` row:

```diff
-| `resume` | `⚠ this run can be resumed where it stopped: /agy:resume <id>` | Fires alongside the watchdog line when the conversation id was captured on the `init` event. Re-dispatching the brief instead is an alternative if the run diverged before the timeout. |
+| `resume` | `⚠ this run can be resumed where it stopped: /agy:resume <id>` | The run ended before agy finished (agy's timeout, the watchdog, a dropped connection, a quota error) and agy kept the conversation. Resuming keeps what agy already read and changed; a fresh dispatch starts from zero. Prefer resume unless the run had clearly gone wrong before it stopped. |
```

`status ERROR` includes runs whose work landed (B1's six runs, and `error-but-succeeded.json`
in the fixtures). Offering resume on those is harmless; the line is an offer, and the
contract text says so.

## K1. Exit non-zero when the run did not finish

Severity: `fix`. `delegate.mjs:250` is correct. Use the shared helper:

```diff
   const finished = readJob(root, jobId);
   if (finished) process.stdout.write(renderResult(finished));
-  return 0;
+  return finished && isUnfinished(finished) ? 1 : 0;
```

`resume.mjs` returns `delegateMain`'s code, so it inherits this. The reporting eval's `quiet`
check requires exit 0 on a clean run; a clean run has no `ERROR`, no kill, no timeout, so it
stays 0. Runs with tool errors only stay 0, as the plan asks.

Add to `commands/delegate.md` (Reading the output section): "A non-zero exit from
`delegate.mjs` means the run did not finish, not that agy's work is wrong. Read the ⚠ lines. If
a `/agy:resume` line is offered, resume rather than re-dispatching."

## I2. Mark orphaned jobs

Severity: `fix`. The rule needs a guard for a record that has no pids yet.

`createJob` (`jobs.mjs:129-146`) writes `status: 'running'` with no `pid`; `pid` arrives in
`runAndRecord`'s first `updateJob` (`delegate.mjs:84-92`) and `cliPid` on spawn. A record read
in that window has no pids. `cancel.mjs:allPidsAlreadyGone` treats "no pid bits" as gone; do not
copy that here. Rule: `orphaned` only when `typeof pid === 'number' && isPidGone(pid)` and
(`cliPid` is not a number or `isPidGone(cliPid)`).

Apply it in `readJobFile` (`jobs.mjs:212-222`) so every reader (`listJobs`, `resolveJob`,
`readJob`, `findRunningJobs`) sees it. Add `'orphaned'` to `JobStatus` (`jobs.mjs:16`).
Consequences that then work without more code: `findRunningJobs` excludes orphans (bare
`/agy:cancel` no longer refuses), `mostRecentFinishedJob` (`status !== 'running'`) includes
them, `result.mjs:40` no longer prints "still running" for them, `cancelJob` on an orphan takes
the `job.status !== 'running'` branch and `cancel.mjs` prints "was not running (already
orphaned)".

Add "orphaned" to `commands/result.md:13` ("running and orphaned jobs are included").

## K3. Short ids stay in this repo

Severity: `ok`, with the exact edit.

`jobs.mjs:243-253` `resolveJob`: delete the last line `return matchQuery(allJobs(), q);` and
replace with `return localHit;`. Delete `allJobs()` (`jobs.mjs:234-236`), then unused. Keep
`locateJobFile`'s cross-repo scan (`jobs.mjs:185-193`): it only matches a full `<id>.json`
file name, which is the "unless a full job id is given" case, and `tests/jobs.test.mjs:180-185`
depends on it for `updateJob`. `tests/jobs.test.mjs:60-85` keep passing (single repo).

`commands/result.md:15` and `commands/cancel.md:9`: "Job ids resolve by full name, unique
prefix, or the 4-char suffix alone" → append ", within this repository".

## X1. Say when agy compacted its context

Severity: `blocks` as written. Counting every `checkpoint` step prints the warning on every run.

All five committed fixtures have a `step_type: "checkpoint"` at `step_index: 1`, directly after
the `user_input` step and before any tool call:

```
tests/fixtures/agy-events/read-and-command.ndjson:3
{"event":"step_update","step_update":{"conversation_id":"4a9488fe-…","step_index":1,"state":"DONE","step_type":"checkpoint","duration_seconds":3.4355054}}
```

Same at line 3 of `add-dir-works`, `permission-denied`, `scratch-wander`,
`scratch-wander-in-git-repo`. `read-and-command` is a 14-line run with 13,717 input tokens; it
did not compact. So a checkpoint step is emitted at the start of every run, and "count
checkpoint steps" would print `⚠ agy compacted its context 1 time(s)` on every clean run,
failing the reporting eval's "Clean run is quiet" (52 of 52 today).

Fix: count only checkpoint steps that come after the first `tool` or `agent_response` step:

```js
let sawWork = false;
let compactions = 0;
// inside the step_update branch, before the `if (su.step_type === 'tool')` block:
if (su.step_type === 'tool' || su.step_type === 'agent_response') sawWork = true;
else if (su.step_type === 'checkpoint' && sawWork) compactions += 1;
```

Add `compactions` to the summary, the job record and typedef; add `"compaction"` to
`WARNING_IDS` after `"tool-errors"` and before `"agy-error"` with the row in `contract.md`;
`{ id: 'compaction', line: `agy compacted its context ${n} time${n === 1 ? '' : 's'} during this run; check the diff against the brief` }`.
Add a unit test asserting `compactions === 0` for `read-and-command.ndjson`. Not a papercut
(it is information about the run, not friction). The sidecar-instruction experiment stays
untested and unadopted.

## B2. Surface `denied_actions`

Severity: `polish`. No committed fixture contains `denied_actions` (`rg denied_actions
tests/fixtures` → 0). Implement only as a harmless guard in the `result` branch of
`summariseEvents`: `if (Array.isArray(r.denied_actions) && r.denied_actions.length) deniedActions = r.denied_actions;`,
store on the record, add `"denied"` to `WARNING_IDS` (after `"compaction"`) and a contract row.
If the field never appears in the stream-json envelope the code is dead but does no harm.

## B1, J3

Severity: `ok`. No code. Nothing to check.

---

## K5. Retire the runner

Severity: `fix`. Correct decision; two citations are wrong and the brief guidance has nowhere
to go unless K5 moves it.

- The plan says the runner's tools are "Bash, Read, Monitor and AskUserQuestion"
  (file 3, Background). Committed frontmatter is `tools: [Bash, Read, AskUserQuestion]`
  (`agy-runner.md:4`). No Monitor.
- The plan quotes "stop and wait" at `agy-runner.md:83`. The committed file has no such text;
  line 81 reads "Set the Bash tool's `run_in_background: true`. agy runs in its own process and
  the harness reports the exit." The quote is from the uncommitted edits, which do not exist in
  this checkout (`git status agents/` is clean). Cite it as "the uncommitted runner edits" or
  drop it.
- Delete: `agents/agy-runner.md`; `README.md:32` ("Plus an **`agy-runner`** agent …");
  `README.md:76` "preloaded into `agy-runner` and" ; `evals/caller.eval.mjs:89-96` the
  `runner-subagent` case (it prompts "Use the agy-runner subagent"; with the agent gone the case
  can only fail). Add a `### Removed` entry to `CHANGELOG.md` (Unreleased).
- Move the brief anatomy from `agy-runner.md:21-51` into `commands/delegate.md`. Replacement
  text for `commands/delegate.md`, inserted after "## The job name":

```markdown
## Writing the brief

agy has no conversation context. Everything the task depends on goes in the brief.
Write for a fast executor working from a contract, not a collaborator you can correct
mid-run. Do not pre-read the repo to write it: name the files and let agy read them.

Every brief has these sections, in this order:

1. **Goal**: one or two sentences. What is the outcome, and what is it a step of.
2. **Repo context**: one or two lines. Stack, and which convention file to follow
   (`AGENTS.md`, `CLAUDE.md`) if the repo has one.
3. **Acceptance criteria**: one to five concrete, checkable bullets.
4. **Files to touch**: an explicit list. agy must not wander outside it unless the task
   cannot predict the list.
5. **How to verify**: the exact command that proves the task is done. Without it agy
   declares "done" on unverified work.

Then a short **Guardrails** block: do not commit; do not delete files outside the list; do
not rename public APIs unless asked; do not touch lockfiles unless the task is about
dependencies; if a pre-existing test already fails, report it, do not fix it.

Point at files rather than pasting them. A spec that already lives in the repo is a path
in the brief, not a copy.

One dispatch per coherent slice. Run at most three agy jobs at once.
```

  The last sentence is a decision the settled note leaves as a range ("3 to 5"); see the
  contradictions section.

## G2

Severity: `ok`. Dropped, nothing to do.

## C1 and C2. Pass the brief as a file path

Severity: `fix`. The mechanism is right. Three gaps.

1. **Backslashes are eaten on the `--arg-string` path.** `splitArgString` treats `\` as an
   escape outside single quotes (`args.mjs:36-39`). Checked:
   `splitArgString('--prompt-file "C:\\Users\\Ahmed Ibrahim\\.cad\\briefs\\b.md"')` returns
   `C:UsersAhmed Ibrahim.cadbriefsb.md`. A forward-slash path survives. `commands/delegate.md`
   must say: write the path with forward slashes (`C:/Users/…`). Bash-tokenised argv (no
   `--arg-string`) is unaffected.
2. **Where Claude writes the brief is unspecified.** Fix it: `~/.cad/briefs/<job-slug>.md`
   (`CAD_HOME` when set). Outside every repo, so it is never committed, and `delegate.mjs`
   copies it to the job sidecar as the plan says.
3. **`Write` is missing from `allowed-tools`.** `commands/delegate.md:4` lists
   `Bash(node:*), AskUserQuestion, Bash(cat:*)`. After M1 and C2 it should be
   `Bash(node:*), Bash(cat:*), Write`.

Code shape for `delegate.mjs` (mirror `plugins/grok/scripts/delegate.mjs:46-61`, which already
has `--prompt-file`): read `flags['prompt-file']`; error `2` when both a positional task and
`--prompt-file` are given; error when the file cannot be read; the prompt text is the file
content. The job name is derived from the prompt text (`uniqueJobName(root, prompt)`), so it
slugs the brief's first words. Store `briefPath` (the original path) on the record for
reference. `resume.mjs` gets it through F2's pass-through, no separate code.

Replacement for `commands/delegate.md:44-56` ("Run it"):

```markdown
## Run it

1. Write the brief with the **Write** tool to `~/.cad/briefs/<short-name>.md`. Never put
   a brief longer than one line on the command line.
2. Dispatch with the Bash tool, `run_in_background: true`, forward slashes in the path:

   node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- --prompt-file "C:/Users/<you>/.cad/briefs/<short-name>.md" [--effort <level>] [--timeout <sec>]

   A one-line task can go inline instead: `-- --effort low "Rename X to Y in src/a.mjs"`.
3. Stop. The task notification arrives when agy finishes. Do not read the job log, the
   task output file or `~/.cad/jobs` while it runs, and do not loop on `/agy:result`. If
   the user asks how it is going, run `/agy:result <job>` once.
```

Step 3 is D1's rule.

## D1. Waiting rule and `/agy:result` for running jobs

Severity: `fix`. One proposed field cannot be computed.

`result.mjs:40-45` is the branch to extend. Compute from `parseEvents(readFileSync(job.rawLogPath))`
then `summariseEvents`: elapsed (`Date.now() - Date.parse(job.startedAt)`), `toolCalls`,
last tool (`su.tool_name` of the last `tool` step; add `lastTool` to the summary), tool
failures so far marked "agy may retry". Drop "whether the model has started its write-up":
`agent_response` steps occur after every model turn (15 of them in
`read-and-command.ndjson`, a 14-line run), so their presence does not mean the final write-up
has begun. Print, for example:

```
Job `x-a7f3` is still running: 4m12s elapsed, 23 tool calls, last tool run_command,
1 tool failure so far (agy may retry). Wait for the task notification, or re-run
/agy:result x-a7f3 later.
```

The `rawLogPath` is written line by line (`agy.mjs:433-436`), so a partial read is safe;
`parseLine` returns null on a torn last line.

## D2

Severity: `ok`. Not built. Nothing to check.

## D3. Commit the runner edits

Severity: `edited in review`. Drop. K5 is fixed, and this checkout has no uncommitted edits to
`agents/agy-runner.md`.

## F2. Resume keeps every flag

Severity: `fix`. Rebuilding from the parsed `flags` object will duplicate flags.

`parseArgv` stores every flag twice, kebab and camelCase (`args.mjs:7`; verified:
`parseCommandArgv(['--prompt-file','x'])` yields both `prompt-file` and `promptFile`). So
"pass through every flag" must work on tokens, not on `flags`. `resume.mjs:52-64`
`dispatchWithConversation` becomes:

```js
async function dispatchWithConversation(conversationId, rawArgv, jobToken) {
  const tokens = collapseCommandArgv(rawArgv);           // expands --arg-string, strips `--`
  const i = jobToken === undefined ? -1 : tokens.indexOf(jobToken);
  if (i !== -1) tokens.splice(i, 1);
  return delegateMain(['--conversation', conversationId, ...tokens]);
}
```

`collapseCommandArgv` is already exported (`args.mjs:187`). The UUID branch passes `first` as
`jobToken` too. Delete the five hand-copied flags and the `--no-git-check` copy (A2).

## F3. Resume with no id

Severity: `ok`, with the exact edits.

`resume.mjs:43-45`: replace with

```js
const recent = listJobs(root).find((j) => typeof j.conversationId === 'string' && j.conversationId);
if (!recent) {
  process.stderr.write('No resumable agy job in this repository. Pass a job id or a conversation uuid.\n');
  return 2;
}
return dispatchWithConversation(recent.conversationId, rawArgv, undefined);
```

Import `listJobs` instead of `mostRecentJob`; delete `mostRecentJob` from `jobs.mjs:395-397`
if nothing else uses it (`rg mostRecentJob scripts/` → only `resume.mjs`). Keep the `explicit`
branch (`resume.mjs:23-26`): an explicit `--continue` still passes through, as the plan says
only the fallback goes. Rewrite `commands/resume.md:9`:

```markdown
Treat the output like `/agy:delegate`. A job id (full, prefix, or 4-char suffix, this
repository only) resumes that job's conversation; a UUID passes through as
`--conversation`; with neither, the newest job in this repository that has a conversation
id is resumed. If none has one, the command says so and stops; it never falls back to
`--continue`.
```

Update `commands/resume.md:3` `argument-hint` to `'[job-id|conversation-uuid] [--prompt-file <path>] [--model <id>] [--effort <level>] [--timeout <sec>] [follow-up task...]'`.
Also fix the `resume.mjs:10-16` doc comment, which describes the fallback.

## M1b (file 3 "M1"). Effort for every model

Severity: `fix`. Needs the cache shape spelled out and a home for the note line.

- Family = id with `/-(low|medium|high)$/` removed. From `cachedModels()`: build
  `Map<family, Set<level>>`. A family "has levels" when the set is non-empty. Given
  `--model M`:
  - `modelEncodesEffort(M)`: pass as is, no `--effort` (today's behaviour, `agy.mjs:107`).
  - `M` is a family with levels: pass `--model M --effort <level>`.
  - `M` is a full id with no levels (no cached id starts with `M-low|medium|high`): drop
    `--effort`, print the note.
  - No cache: today's behaviour.
- **Where the note prints.** Not as a ⚠ line and not in the result block (the contract says a
  clean run is agy's report alone). Print it at dispatch time next to the job name line in
  `delegate.mjs:244`: `agy \`x-a7f3\` (note: --effort does not apply to claude-opus-4-6-thinking; dropped)`.
- `--print-models` in `setup.mjs` becomes the generator for the table and reads the cache,
  not the network (M3 says "no added delay before a run"): print `family<TAB>levels|none`, one
  line per family, from `cachedModels()`; fall back to the live list only when there is no cache.
  Update the docstring at `setup.mjs:19-21`. Then add to `commands/delegate.md` under "Model
  and effort":

```markdown
Models agy accepts right now (family, then the effort levels it takes):

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --print-models`

Pass `--model <family> --effort <level>`, or a full id such as `gemini-3.8-flash-high` with
no `--effort`. A model with no levels ignores `--effort`; the plugin drops it and says so.
```

- The reporting eval `effort` check (`reporting.eval.mjs:130-143`) passes
  `--model claude-opus-4-6-thinking --effort high` with a stub whose `models` output lists
  that id with no levels; the new rule satisfies it.

## M2. Unknown model

Severity: `ok`, with the exact site. In `render.mjs:157-166` (`agy-error` branch): when
`/invalid model selection/i.test(job.error)`, replace `detail` with `['Valid ids:', ...cachedModels().map((m) => `  ${m.id}`)]`.
`render.mjs` importing `cachedModels` from `./agy.mjs` creates no cycle (`agy.mjs` imports
`killtree`, `parse`, `paths`, `run`). M3's immediate refresh runs in `delegate.mjs` before
`renderResult`, so the list is fresh.

## M3. Weekly cache refresh

Severity: `fix`. "In the background" contradicts the plugin's one-process rule and the
implementer will guess.

The Unreleased changelog (`CHANGELOG.md:7-10`) removed every detached worker on purpose. Do
not spawn a detached refresh. Instead, in `delegate.mjs main`, after `renderResult` is
written and before returning: if `fetchedAt` in `models.json` (`agy.mjs:318` writes it) is
older than 7 days, `await listModels()` (already bounded by `timeoutMs: 10_000`,
`agy.mjs:270`) and `writeModelCache(models, readAccountDefaultLabel(), version)`. The caller
already has the output; the task notification arrives up to ~2 s later. Wrap in try/catch;
a failed refresh must not change the exit code.

Simplify the version stamp: have the same refresh run `agy --version` (0.1 s) and store it,
instead of adding an `agy --version` call to every papercut write. `cachedToolVersion()` then
keeps working unchanged. Update the comments at `agy.mjs:279-283` ("saved during the last
`/agy:setup` run (the sole writer)"), `:297-298` ("does not auto-expire"), `:304` ("Only
`/agy:setup` calls this"), and `README.md:28`. `tests/agy.test.mjs:317` ("never expires on its
own") still holds for reads; keep it.

## H1. `/agy:update`

Severity: `polish`. Needs `commands/update.md` and `scripts/update.mjs`; the plan gives the
steps. Whether `agy update` and `agy changelog <from> <to>` exist with those names on 1.2.2 is
under "could not verify"; check `agy --help` before writing the script. Build it last.

## T1. Timeouts

Severity: `fix`. The constant and docs are right; tests and one unspecified item.

- `agy.mjs:11` `DEFAULT_PRINT_TIMEOUT_SEC = 900` → `3600`. `formatPrintTimeout(3600)` gives
  `60m` (checked). `args.mjs:219` `parseTimeout(raw, fallback = 900)`: change the default to
  3600 and update `tests/args.test.mjs:210-217` (eight assertions expect 900). `delegate.mjs:51`
  passes the constant explicitly, so behaviour does not depend on that default, but leaving 900
  there is a trap.
- Docs: `commands/delegate.md:63` and `README.md:48` "Default 900 (15m)" → "Default 3600
  (60m)". `render.mjs:171` and `contract.md:35` "plus 60s grace" stay.
- Rename: `graceMs` → `taskkillTimeoutMs` at `killtree.mjs:27,30,32,38,41,85`, `run.mjs:74`,
  `agy.mjs:452`, `jobs.mjs:355,358,364,367`. Comments: `run.mjs:3` "tree-kill the child, 5 s
  grace" → "taskkill the child tree; give taskkill 5 s to return"; `agy.mjs:367` "Escalate to
  SIGKILL" → "Terminate the direct child if taskkill did not"; `killtree.mjs:22-25` already
  describes taskkill correctly. `commands/cancel.md:2` → `description: Cancel an active agy job by force-killing agy and its child processes.`
  `WATCHDOG_GRACE_SEC` is a real grace (60 s the plugin waits past agy's own limit); keep the
  name.
- "Store the resolved path" for `where agy` names no location. Skip it unless trivial: add
  `bin` to `models.json` in `writeModelCache`, and in `resolveBin` check `existsSync(cached.bin)`
  before running `where`. Do not build anything larger.

## Settled items

`--dangerously-skip-permissions` at `agy.mjs:108`: verified. The rest are facts about agy, not
code; nothing to implement.

---

## Prompt review

### `commands/delegate.md`

Already changed by the plan: lines 3-4 (A2, M1, C2), 19-42 (M1, M1b), 44-56 (C2, D1), 58-67
(A2, T1, C1), 69-74 (K1). Missing or wrong beyond that:

- Line 21-23 says the model comes from the "live `agy models` list". It comes from the cache
  (`agy.mjs:330-338`). Fixed by the M1 replacement text above.
- No brief-writing guidance. It lives only in the runner. Moved by K5.
- No fan-out guidance at all. Fixed by K5's text ("at most three agy jobs at once").
- Line 73-74 "review the diff yourself before telling the user it is done" gives no scope. The
  second attachment (section 5.4) reports callers running whole-monorepo test suites after a
  slice and chasing pre-existing failures. Replace with: "After a job that changed code, read
  `git diff` for the files the brief named and run the verification command the brief gave.
  Do not run the repository's whole test suite over a slice." (Transcript evidence not
  verified here; the change is safe regardless.)
- Line 67 `--continue` row says "Machine-wide". After F3 the plugin never adds it; keep the
  row for explicit use but say "Only when you pass it yourself; the plugin never falls back to
  it."
- The output contract is included with `!cat` at line 71. Keep.

### `commands/resume.md`

Changed by F3, F2, K3 (lines 3, 9). Missing: the contract is not included, though line 9 says
"Treat the output identically to `/agy:delegate`". Add
``!`cat "${CLAUDE_PLUGIN_ROOT}/skills/output-contract/contract.md"` `` after line 9, as
`result.md:11` does.

### `commands/result.md`

Changed by I2 (line 13), K3 (line 15), D1 (describe the running-job block: "For a running job
the output is a one-paragraph progress line, not a result. Relay it and wait.").

### `commands/cancel.md`

Changed by T1 (line 2), K3 (line 9). After I2 add: "A job whose processes are already gone is
reported as orphaned; nothing is killed."

### `commands/setup.md`

Line 9 "the live model list from `agy models`" stays true for `/agy:setup`. Add one sentence
for M3: "The model cache is also refreshed after any run once it is a week old, and whenever
agy rejects a model name."

### `commands/papercut.md`, `commands/kaizen.md`

Covered by the P1 diff, plus `papercut.md:24` (A5).

### `agents/agy-runner.md` (committed version)

Deleted by K5. Every finding about it (G1, M1, D1, D3, the false Monitor and line-83 citations)
resolves by deletion, except the brief anatomy, which K5 moves.

### `skills/output-contract/SKILL.md`, `contract.md`

`SKILL.md` needs no change. `contract.md` rows: `agy-status` (A4), `stderr` (K4), `resume`
(F1), delete `wander` (A1), add `compaction` (X1), `denied` (B2), `timeout` (J1), in
`WARNING_IDS` order. Final order:
`agy-status, exit, stderr, tool-errors, compaction, denied, agy-error, watchdog, timeout, resume`.
Rule 2 (A4). Add after rule 3: "`delegate.mjs` exits 1 when the run did not finish. That is a
fact about the run, not a verdict on the work; the ⚠ lines say why."

### `SIDECAR_INSTRUCTION` (`agy.mjs:14-15`)

"Read the file at %PATH% in full and carry out that task exactly." No item changes it and none
should: after C1 it is still what agy receives. X1's compaction sentence is explicitly "test
before adopting". No edit.

---

## Contradictions between items, with resolutions

| Items | Contradiction | Resolution |
| --- | --- | --- |
| G1, M1, D3 vs K5 | Three items edit or commit `agy-runner.md`; K5 deletes it. | Delete in K5; G1 no-op; M1 edits `delegate.md` only; D3 dropped. |
| M1 (file 1) vs M1 (file 3) | Same id, different items. | File 3's is M1b. |
| File 2 header vs K4/J1 text | Header says "J1 and K4 come first"; J1 says "builds on" K4. | K4 first. |
| F1 vs K1 vs K2 | Each defines "unfinished" differently; K2's rule needs `toolCalls`, which the record lacks. | One `isUnfinished(job)` in `render.mjs`; store `toolCalls`; land K2 before F1 and K1. |
| J1 line text vs J1 evidence | Line says `after <N>s`; agy prints Go durations (`1h0m0s`). | Print agy's token verbatim. |
| X1 vs "Clean run is quiet" | Every fixture has a checkpoint step before any work. | Count checkpoints only after the first tool/agent_response step. |
| M3 vs Unreleased changelog | "Refresh in the background" vs the removal of every detached path. | Await the refresh after printing; no detached process. |
| M1b vs M3 vs `delegate.md` table | Table "generated from the cache"; `--print-models` today fetches live and rewrites the cache. | `--print-models` reads the cache; falls back to live only with no cache. |
| Settled "max fan-out 3 to 5" vs the fan-out record in the second attachment | The attachment lists 9 fan-outs, 28 jobs, 14 finished; the one 5-way fan-out lost 5 of 5 at 900 s. The prompt needs one number. | Write "at most three" into `delegate.md`. Owner may raise it after T1 (3600 s) changes the picture; the 900 s scope and contention are not separable in that data. |
| C2 "pass a file path" vs `--arg-string` | `splitArgString` eats backslashes in double quotes. | Forward slashes in `delegate.md`; a Bash-tokenised call is unaffected. |
| A4 vs `reporting.eval.mjs` `parallel` | Check reads `gitFiles`. | Delete the check with A4. |
| K5 vs `caller.eval.mjs` `runner-subagent` | Case prompts the deleted agent. | Delete the case with K5. |

## Claims not verified

- Everything measured on live agy 1.2.2: the timeout stderr line, `SUCCESS`/exit 0 on timeout,
  that `--model <family> --effort <level>` is accepted, the `invalid model selection` text,
  `--add-dir` without git, `checkpoint` on compaction, the four stderr lines table, that
  `agy update` and `agy changelog` exist. No agy here.
- All counts over `~/.cad/jobs` (122 or 142 records, 32 wander fires, 31 resumable, 0 of 37
  non-zero exits, and so on) and the eval results table. The fixtures are not committed and the
  job store is on the owner's machine.
- Whether a never-started run (unknown model) has a conversation id. K2 says no. The fixture
  labeller (`evals/build-fixtures.mjs:145`) excludes `never-started` from `resumable`
  separately from `Boolean(conversationId)`, which suggests it can. F1's rule above does not
  depend on the answer.
- PR #2 and its commits `4011c8a`, `03f5aa6`, `4b50747`, `2b75f20`, `681206a`, `836b35f`, and
  `7911ca4c`: none are in this clone (`git cat-file -t` → missing). `3e0d115`, `61daffd`,
  `1134cbd`, `cb1553f`, `bc2f1ce`, `bfcd3cb` exist.
- The uncommitted `agents/agy-runner.md` edits and the `agy-runner.md:83` "stop and wait"
  quote. This checkout has no working-tree change to that file.
- `~/.claude/rules/windows.md` and the 5-7 KB heredoc limit.
- `process.kill(pid, 0)` semantics on Windows for `isPidGone` (I2). Checked only on Linux.
- Every transcript, papercut id and job id cited in the second attachment (fan-out table,
  timeouts inventory, polling loops, read-only violations). Used only for the two prompt
  suggestions marked as such (diff-review scope, fan-out cap).
- Grok's 4800 s watchdog: `plugins/grok/scripts/delegate.mjs:26-29` says 4800 and mentions a
  3600 s idle timeout, as the plan states. The 3600 s against grok itself is not checked.

## Checklist, in landing order

| # | Item | Status |
| --- | --- | --- |
| 1 | A1 wander warning | edited in review (full deletion list, keep fixtures) |
| 2 | A2 git check, `--no-git-check` | edited in review (extra sites, keep args test) |
| 3 | A3 dirty-tree warning | ok |
| 4 | A4 porcelain snapshots | edited in review (contract rows, tests, delete eval `parallel`) |
| 5 | A5 `filesChanged` | edited in review (`papercut.md:24`, papercuts tests) |
| 6 | A6 `repoRoot` | ok |
| 7 | G1 pre-read mandate | edited in review (no-op; superseded by K5) |
| 8 | M1 AskUserQuestion | edited in review (`allowed-tools`, wrong "live list" text, keep `--print-models`) |
| 9 | P1 `orchestrator` source | ok (diff applies; changelog polish) |
| 10 | K4 stderr on every run | edited in review (line text, contract row, two tests deleted) |
| 11 | J1 agy timeout | edited in review (Go duration, detection site, registry, papercut) |
| 12 | K2 never-started = failed | blocked until `toolCalls` is stored; then ok |
| 13 | F1 resume offer | edited in review (`isUnfinished`, exclude `failed`, contract row) |
| 14 | K1 non-zero exit | edited in review (uses `isUnfinished`; delegate.md sentence) |
| 15 | I2 orphaned jobs | edited in review (no-pid guard; apply in `readJobFile`) |
| 16 | K3 suffix in this repo | ok (exact edit given; keep `locateJobFile`) |
| 17 | X1 compactions | blocked as written; ok with the after-first-work rule |
| 18 | B2 `denied_actions` | ok as a guard only |
| 19 | B1 refused artifact writes | ok (no code) |
| 20 | J3 dropped connections | ok (no code) |
| 21 | K5 retire the runner | edited in review (citations; move brief anatomy; delete eval case, README lines) |
| 22 | G2 runner reuse | ok (dropped) |
| 23 | C1 `--prompt-file` | edited in review (copy to sidecar; both-given error) |
| 24 | C2 Write tool + path | edited in review (forward slashes, brief location, `Write` in `allowed-tools`) |
| 25 | D1 waiting rule, `/agy:result` progress | edited in review (drop the "write-up started" field) |
| 26 | D2 PreToolUse hook | ok (not built) |
| 27 | D3 commit runner edits | edited in review (dropped) |
| 28 | F2 resume passes every flag | edited in review (token-based, not `flags`-based) |
| 29 | F3 resume with no id | ok (exact edit given; `resume.md` text) |
| 30 | M1b effort for every model | edited in review (cache shape, note placement, `--print-models` from cache) |
| 31 | M2 unknown model list | ok (site given) |
| 32 | M3 weekly refresh | edited in review (await after print; version stamp in the same refresh) |
| 33 | H1 `/agy:update` | ok, build last, check the agy subcommands first |
| 34 | T1 timeouts | edited in review (`parseTimeout` default and tests; skip "store the path" unless trivial) |
| 35 | Settled items | ok |
