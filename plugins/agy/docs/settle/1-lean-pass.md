# agy settle list 1 of 3: the lean pass

Removals only. Nothing here adds behaviour. This batch lands first, because files 2 and 3
change code that this batch deletes or simplifies.

Scope is the agy plugin only. Checked against `main` plus the working tree, 122 job records in
`~/.cad/jobs`, and live agy 1.2.2 on 2026-09-12 and 2026-09-13.

## Landing order

File 1 lands first, then file 2, then file 3. One commit per item, in the order each file
lists its items, with two exceptions:

- **The `splitArgString` backslash fix lands before everything else, as its own commit.**
  It is described under C1/C2 in file 3, but it has to land first because C1 and C2 depend on
  Windows paths surviving `--arg-string` parsing, and nothing else in the three files touches
  argument parsing.
- **File 2's internal order is K4, J1, K2, F1, K1, I2, K3, X1, B2, B1, J3**, not the order the
  items appear in that file. K4 has to land before J1, since J1 detects a stderr line that K4
  stops hiding. K2 has to land before F1 and K1, since both of those rely on K2's "did the run
  finish" rule and share one `isUnfinished(job)` definition with it (see F1 in file 2).
- **K5 (retire the `agy-runner` subagent) is the first commit of file 3.** G1 and M1 below were
  both written to edit `agents/agy-runner.md`, the file K5 deletes. Neither touches it: G1 is a
  no-op (see G1 below) and M1 edits only `commands/delegate.md`, so file 1 still lands first and
  nothing in it depends on K5.

## How this batch is committed

One commit per item, in the order below. PR #2 "agy: the lean pass"
was closed without merging on 2026-09-13. Its branch is kept as reference only: local `pr2`,
remote `hoplite/sinope-c639038a`. The Hoplite bot opened it on 2026-09-04. Its commits:

| Commit | What it did | Use |
| --- | --- | --- |
| `4011c8a` | cut 0.2.0 | Redo at the end of all three batches |
| `03f5aa6` | remove the wander warning | Reference for A1 |
| `4b50747` | remove the non-repository paths | Reference for A2 and A3 |
| `2b75f20` | keep the porcelain snapshots | Do not take. A4 removes them |
| `681206a` | move the agy-agnostic helpers into `lib/util/` | Decide after this batch |
| `836b35f` | trim the README | Redo after all three batches, since they change the README |

---

## A1. Remove the wander warning

**Story.** Early agy runs without a workspace wrote their files into
`~/.gemini/antigravity-cli/scratch` and still reported success. The plugin added a check:
if agy's write-up sounds like it changed files, and git shows no change, print
"agy reported file changes but the working tree is unchanged". The plugin now always passes
`--add-dir <repo>`, which binds agy to the repo, so the case it guarded against is handled
at the source.

**Why it is a problem now.** The check reads agy's prose, not what agy did. It fires when the
write-up contains a `file://` link, or "created", "wrote", "modified" or "updated" near
something that looks like a file extension (`parse.mjs:81`).

Checked on 2026-09-14 against every job record and agy's own transcripts:

- It fired on 32 runs. 28 were set off by a `file://` link, 4 by a verb near a file extension.
- It never caught the case it was built for. Across 142 recorded runs, no run wrote a file
  into agy's `scratch` folder.
- 13 of the 32 runs committed their work with `git commit`. After a commit the working tree is
  clean, so the check read real edits as "nothing changed".
- 7 made no write at all. They were read-only or research runs whose answers linked the files
  they cited.
- 12 wrote something, yet git showed no new change. Likely causes are a file that was already
  modified before the run (see A4), or a write outside the repo. Not checked one by one.

In the outcomes eval (2026-09-12), agy was asked which export under `src/` nothing imports,
and told not to write a file. agy's transcript in
`~/.gemini/antigravity-cli/brain/72e0895c-.../logs/transcript.jsonl` shows seven tool calls:
`view_file` on the brief, `find_by_name` twice, `view_file` three times, `list_dir` once. None
wrote anything. Its answer was one sentence with two Markdown links, both `file:///.../src/b.mjs`.
Run through `claimsFileChanges`, the `file://` rule matched and the verb rule did not. With the
links removed, the same sentence does not trigger it.

**Change.** Delete, all verified at HEAD:

- `scripts/lib/parse.mjs:72` `SCRATCH_RE`, `:81` `claimsFileChanges`, `:101` `toolParamPaths`
  (only used to feed `scratchPaths`, `:188-193`), `:159-161` and `:239-241` `scratchPaths`,
  `writeTargets`, `claimedFileChanges`.
- `scripts/lib/render.mjs:25` `WANDER_WARNING`, `:68` `"wander"` in `WARNING_IDS`, `:183-187`
  the anomaly, `:46` `claimedFileChanges` in the typedef.
- `scripts/lib/papercuts.mjs:42` `wander` in `DETECTED_WARNINGS`, `:145-154` the `wander`
  branch of `evidenceFor`.
- `scripts/delegate.mjs:148` `claimedFileChanges`, `:172-173` `writeTargets`, `scratchPaths`.
- `scripts/lib/jobs.mjs:45` `claimedFileChanges` in the `JobRecord` typedef.
- `skills/output-contract/contract.md:37` the `wander` row (`tests/contract.test.mjs` checks
  the row and the `WARNING_IDS` entry stay in sync, so remove both together).
- `README.md:74` the wander row in the warnings table.
- Tests: `tests/render.test.mjs:2` (`WANDER_WARNING` import), `:101-122` (two wander tests),
  `:95`, `:107`, `:119`, `:160` (`claimedFileChanges` setup). `tests/parse.test.mjs:3`
  (`claimsFileChanges`, `toolParamPaths` imports), `:43-48` (`toolParamPaths` test), `:50-58`
  (`claimsFileChanges` tests), `:84-86`, `:113-127`, `:144` (`claimedFileChanges`,
  `writeTargets`, `scratchPaths` assertions). `tests/papercuts.test.mjs:64-65`
  (`writeTargets`/`scratchPaths` setup), `:68-79` ("turns a wander into one cut"), `:122`
  (a cut with `warningId: 'wander'`).

Keep the fixtures `tests/fixtures/agy-events/scratch-wander*.ndjson`:
`tests/parse.test.mjs:128-138` uses them for the `run_command` exit-code assertion, which is
unrelated to wander. Delete only the wander assertions in those tests, not the fixtures.

## A2. Remove the git repository check and `--no-git-check`

**Story.** Inherited from the April 2026 scaffold (`1134cbd`). Before doing anything,
`delegate.mjs:221` runs `git rev-parse --is-inside-work-tree` in the folder Claude Code
runs it from (`if (!(await isRepo(process.cwd())) && !flags.noGitCheck)`). If that folder is
not inside a git work tree, it prints "current directory is not a git repository" and exits 2
without writing a job record. `--no-git-check` skips the refusal.

In practice: a repo subfolder passes, a git worktree passes (it has a `.git` file), and a
plain folder with no `.git` anywhere above it is refused. The check existed because the
before/after snapshots in A4 need git.

**Why it goes.** Once A4 removes the snapshots, nothing in the plugin needs git except
`repoRoot`, which already works without it (A6). agy itself does not need git: on 2026-09-13
runs from a temp folder with no `.git` ended `SUCCESS`. The refusal is the plugin's own
`isRepo` check, not something agy enforces.

`--add-dir` does not need git either. Checked on 2026-09-14: agy was started from one temp folder
with `--add-dir` pointing at a second temp folder with no `.git`, and asked to create
`hello.txt` there. It ended `SUCCESS` and the file landed in the `--add-dir` folder. agy's help
describes the flag only as "Add a directory to the workspace (repeatable)", and neither the help,
the changelog nor Google's CLI docs mention git for it.

**Change.** Delete `isRepo`, the refusal at `delegate.mjs:221`, the `--no-git-check` flag
(`delegate.mjs:41` parse, `:52`, and `resume.mjs:59-61`'s rebuild), `isRepo(root)` inside
`runAndRecord` (`delegate.mjs:74`, which feeds `gitRepo`), the `gitRepo` field
(`delegate.mjs:89`, `:146`, `jobs.mjs:42` typedef, `render.mjs:40` typedef, and
`render.mjs:83`'s `if (job.gitRepo !== false)`, which goes together with A4), and the flag's
mentions in `commands/delegate.md:3`, `:65` and `README.md:50`.

Keep `tests/args.test.mjs:93` (`parseArgv(['--no-git-check'], ['git-check'])`): it tests the
parser's generic `--no-` negation using an arbitrary flag name, not the feature itself.

## A3. Remove the dirty-tree warning

**Story.** Same scaffold. `delegate.mjs:230` runs `git status` and prints
"Warning: working tree is dirty. agy will see the uncommitted changes." whenever any file is
uncommitted.

**Why it goes.** Delegating while work is uncommitted is the normal case, so the line prints
on nearly every run and tells the caller nothing it can act on. It also costs one git call.

**Change.** Delete `isDirty` and the warning at `delegate.mjs:230`. `isDirty` is called only
there.

## A4. Remove the before/after porcelain snapshots

**Story.** Since the first agy commit (`61daffd`, 2026-08-24), `runAndRecord` runs
`git status --porcelain` before spawning agy and again after, and stores the lines that
differ as `gitFiles`.

**What the snapshots gave the plugin**, and all of it:

1. The file count inside the `⚠ agy status:` line, as in `(write-up present, 2 files changed)`.
   Clean runs never show a count.
2. The "working tree is unchanged" half of the wander warning (A1).
3. `filesChanged` in papercut rows, used by `/agy:kaizen` (A5).
4. The `gitFiles` and `gitBefore` lists in the job record. Nothing else reads them.

**Why they are wrong**, beyond parallel runs. The diff compares whole-tree status lines:

- Parallel jobs count each other's edits. Five comment-cleanup jobs on 2026-08-28 each
  reported 19 files changed.
- A file that was already modified before the run keeps the same `M path` line after agy
  edits it again, so agy's edit is not counted. This happens with a single job.
- Your own edits during the run are counted as agy's.
- Files agy writes outside the repo, or into ignored paths, are not counted.

Claude reviews `git diff` itself after a run, which is the reliable view.

**Change.** In `scripts/lib/git.mjs`, keep only `repoRoot` and its `run` import; delete
`parsePorcelain`, `porcelainLetter`, `porcelain`, `isDirty`, `porcelainDelta` and the `GitFile`
typedef, which is defined twice (once in `git.mjs`, again at `render.mjs:29-33`; delete both
copies). Delete `gitBefore`, `gitFiles` and their typedef lines (`jobs.mjs:43-44`). Delete the
status-line file count in `render.mjs:79` (`statusContext`); after the change it returns
` (write-up present)` or ` (no write-up)`.

Update `skills/output-contract/contract.md:30`:

```diff
-| `agy-status` | `⚠ agy status: <status> (write-up present, N files changed)` | agy's own verdict, verbatim. Not a pass/fail: agy can report `ERROR` on runs that worked and `SUCCESS` on runs that did not. The parenthetical reports whether a write-up exists and the file count from before and after `git status --porcelain` snapshots. The file count is omitted outside a git repo. |
+| `agy-status` | `⚠ agy status: <status> (write-up present)` | agy's own verdict, verbatim. Not a pass/fail: agy can report `ERROR` on runs that worked and `SUCCESS` on runs that did not. The parenthetical says only whether agy returned a write-up. Check `git diff` yourself for what changed. |
```

And `contract.md:16-18`, rule 2:

```diff
-2. **Never fold two into one verdict.** agy's own status, the process exit code,
-   and the state of the working tree are independent facts that disagree in both
-   directions. Each is allowed to fire alone.
+2. **Never fold two into one verdict.** agy's own status, the process exit code,
+   and what agy wrote to stderr are independent facts that disagree in both
+   directions. Each is allowed to fire alone.
```

`render.mjs:4-6`'s header comment says "working tree modifications remain separate facts";
drop that phrase.

Tests to rewrite: `tests/render.test.mjs:9-10` (`gitRepo`, `gitFiles` in the test `base`),
`:44-64` (the two file-count tests, "measures the ERROR" and "singularises one file"), `:91`,
`:106`, `:118`, `:157-158`, `:166`, `:175-176`.

**Eval.** `evals/reporting.eval.mjs:110-128` `scenarioParallel` grades `j?.gitFiles?.length`
(the `parallel` check, "Parallel jobs count only their own files", line 47). With `gitFiles`
gone it fails forever. Delete the `parallel` check, the `scenarioParallel` scenario, and its
call site.

## A5. Drop `filesChanged` and the calls-per-file check in `/agy:kaizen`

**Story.** `commands/kaizen.md:26` tells the orchestrator to compare `toolCalls` with
`filesChanged`: forty tool calls for one file suggests agy was going in circles. A4 is its
only data source, so the number is wrong in every case listed there.

**Change.** Remove `filesChanged` from `papercuts.mjs` (`:63` typedef, `:188`), `papercut.mjs`
(`:85`), `kaizen.mjs` (`:52-55`, the `calls / files` bit in `line()`) and `commands/kaizen.md`
(`:26-29`, covered by the P1 diff), and `delegate.mjs:170`. Keep `toolCalls` in
`kaizen.mjs:52-55`: `bits.push(`${cut.toolCalls} calls`)`.

Also:
- `commands/papercut.md:24`: "the run's model, conversation and file count are filled in" →
  "the run's model and conversation are filled in".
- `tests/papercuts.test.mjs:61` (`filesChanged: 0` in ctx) and `:78`
  (`expect(cuts[0].filesChanged).toBe(0)`).

Keep `toolCalls` and duration.

## A6. Keep `repoRoot` as the only git call

**How it works.** `git rev-parse --show-toplevel`. Inside a repo, including a subfolder, it
returns the repo's top folder. Outside git, or if git is missing, it returns the current
folder (`git.mjs:19-26` falls back to `cwd` on non-zero exit).

**What the root is used for.** It is the workspace passed to agy with `--add-dir`, agy's
working folder, and the key for the job folder `~/.cad/jobs/<hash of root>` where
`/agy:result`, `/agy:cancel` and `/agy:resume` look for jobs.

**Worth knowing.** Started from a repo subfolder, agy's workspace is the whole repo, not the
subfolder.

**Change.** None, beyond confirming nothing else calls git after A2 to A5. After those land,
the only callers of `scripts/lib/git.mjs` are `repoRoot`, from `delegate.mjs`, `resume.mjs`,
`result.mjs`, `cancel.mjs` and `papercut.mjs`.

## G1. Delete the pre-read mandate in the runner prompt

**Story.** `agents/agy-runner.md:25-33` told the runner to read `AGENTS.md`, `CLAUDE.md`,
`package.json`, `README.md` and similar files before writing every brief, so the brief can
name the right build and test commands.

**Why it goes.** Past runner sessions spent two to five thousand tokens on it each time, on
Claude's side, before agy starts. agy has its own file tools and can read those files in its
own context, which is the reason to delegate at all.

**Change.** No-op here, superseded by file 3's K5. K5 deletes `agents/agy-runner.md`
entirely, which removes this section along with the rest of the file. `commands/delegate.md`
already tells Claude to let agy inspect files rather than pre-reading the tree (`:11-13`), so
no separate edit to that file is needed for G1.

## M1. Remove the AskUserQuestion model prompt

**Story.** `commands/delegate.md:27-42` and `agents/agy-runner.md:67-69` tell Claude to run
`setup.mjs --print-models` and ask the user to pick a model with AskUserQuestion when the user
mentions models, plus a second question for effort in some cases.

**Why it goes.** The default is already the newest flash model, `gemini-3.8-flash-medium` today.
A user who wants another model names it. The only real gap is a name that matches no model,
which file 3 (M2) handles by listing the valid ids.

**Change.** `agents/agy-runner.md:67-69` is deleted along with the whole file by K5 (file 3);
edit only `commands/delegate.md` here:

- `commands/delegate.md:4` `allowed-tools`: remove `AskUserQuestion`. (C2, file 3, later adds
  `Write`.)
- `commands/delegate.md:19-42` is wrong today beyond the AskUserQuestion flow: lines 21-23 say
  the model id is resolved "from the live `agy models` list", but `resolveDefaultModel`
  (`agy.mjs:330-338`) reads only the cache. Replace lines 19-42 with:

```markdown
## Model and effort

Omit `--model`. The plugin picks the newest **flash** id from the cached `agy models`
list at the `--effort` you pass (`medium` if you pass none). Pass a model only when the
user names one. Never invent an id; the ids agy accepts are listed below.
```

  (M1b, file 3, appends the model table under that heading.)

- `README.md:42` "Claude prompts for a model only when requested in the prompt." → delete the
  sentence.
- `setup.mjs:19-20`'s docstring says the `--print-models` mode exists "for `/agy:delegate` to
  feed into AskUserQuestion". Keep the `--print-models` mode itself: M1b repurposes it to read
  the cache and generate the model table. Just reword the docstring so it no longer names
  AskUserQuestion.

## P1. Remove the "brief defect" papercut source (`orchestrator`)

**Story.** `/agy:papercut` accepts two hand-written sources. `narrated` quotes what agy said got
in its way. `orchestrator` is the case you flagged: after a run, Claude judges that its own brief
was at fault and records what it asked for (`--expected`), what came back (`--got`) and the
failing clause (`--brief-excerpt`). `/agy:kaizen` then tells Claude that a cluster of runs with
many tool calls per changed file "is usually a brief problem, not a tool problem".

**Why it goes.** It asks Claude to grade its own instructions after the fact, which can push
later briefs toward longer and more defensive text, and the tool-calls-per-file signal behind it
is removed in A5. It has never been used: the papercut log holds 64 rows, 63 `detected` and
1 `narrated`, with 0 `orchestrator` rows.

**Change.**
- `scripts/papercut.mjs`: accept only `--source narrated`. Remove `--brief-excerpt`,
  `--expected` and `--got`, and the usage lines for them.
- `commands/papercut.md`: remove the `orchestrator` section and update `argument-hint`.
- `commands/kaizen.md`: remove the "usually a brief problem" sentence (goes with A5).
- `scripts/kaizen.mjs`: `--resolve` currently writes its row with `source: 'orchestrator'`.
  Give it its own source, `resolution`, and keep reading old rows. Update the `--kind` help.
- `scripts/lib/papercuts.mjs`: update the `source` type.
- `README.md` lines 84-86. No test names the source.
- `CHANGELOG.md:32-35` (Unreleased) still advertises the `orchestrator` source: "writes the
  two rows the plugin cannot observe: `narrated` … and `orchestrator` …". The feature never
  shipped, so edit that entry to describe `narrated` only.

The exact before and after for the code sites above is in `diffs/p1-remove-orchestrator.diff`,
made against the current working tree; it applies cleanly to HEAD. The `commands/kaizen.md`
hunk also covers A5.
