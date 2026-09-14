# agy settle list 1 of 3: the lean pass

Removals only. Nothing here adds behaviour. This batch lands first, because files 2 and 3
change code that this batch deletes or simplifies.

Scope is the agy plugin only. Checked against `main` plus the working tree, 122 job records in
`~/.cad/jobs`, and live agy 1.2.2 on 2026-09-12 and 2026-09-13.

## How this batch is committed

One commit per item, in the order below, on a branch off `main`. PR #2 "agy: the lean pass"
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

**Change.** Delete `WANDER_WARNING`, the `wander` anomaly, `claimsFileChanges`,
`claimedFileChanges`, `scratchPaths` and `writeTargets` if nothing else reads them, the
`wander` id in `WARNING_IDS`, and its section in `skills/output-contract/contract.md`.

## A2. Remove the git repository check and `--no-git-check`

**Story.** Inherited from the April 2026 scaffold (`1134cbd`). Before doing anything,
`delegate.mjs:221` runs `git rev-parse --is-inside-work-tree` in the folder Claude Code
runs it from. If that folder is not inside a git work tree, it prints
"current directory is not a git repository" and exits 2 without writing a job record.
`--no-git-check` skips the refusal.

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

**Change.** Delete `isRepo`, the refusal, the `--no-git-check` flag in `delegate.mjs`,
`resume.mjs`, `commands/delegate.md` and the usage string, and `gitRepo` in the job record.

## A3. Remove the dirty-tree warning

**Story.** Same scaffold. `delegate.mjs:230` runs `git status` and prints
"Warning: working tree is dirty. agy will see the uncommitted changes." whenever any file is
uncommitted.

**Why it goes.** Delegating while work is uncommitted is the normal case, so the line prints
on nearly every run and tells the caller nothing it can act on. It also costs one git call.

**Change.** Delete `isDirty` and the warning.

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

**Change.** Delete `porcelain`, `parsePorcelain`, `porcelainDelta`, `gitBefore`, `gitFiles`,
the status-line file count in `render.mjs:79`, and their tests.

## A5. Drop `filesChanged` and the calls-per-file check in `/agy:kaizen`

**Story.** `commands/kaizen.md:26` tells the orchestrator to compare `toolCalls` with
`filesChanged`: forty tool calls for one file suggests agy was going in circles. A4 is its
only data source, so the number is wrong in every case listed there.

**Change.** Remove `filesChanged` from `papercuts.mjs`, `papercut.mjs`, `kaizen.mjs` and
`commands/kaizen.md`. Keep `toolCalls` and duration.

## A6. Keep `repoRoot` as the only git call

**How it works.** `git rev-parse --show-toplevel`. Inside a repo, including a subfolder, it
returns the repo's top folder. Outside git, or if git is missing, it returns the current
folder.

**What the root is used for.** It is the workspace passed to agy with `--add-dir`, agy's
working folder, and the key for the job folder `~/.cad/jobs/<hash of root>` where
`/agy:result`, `/agy:cancel` and `/agy:resume` look for jobs.

**Worth knowing.** Started from a repo subfolder, agy's workspace is the whole repo, not the
subfolder.

**Change.** None, beyond confirming nothing else calls git after A2 to A5.

## G1. Delete the pre-read mandate in the runner prompt

**Story.** `agents/agy-runner.md:25-33` tells the runner to read `AGENTS.md`, `CLAUDE.md`,
`package.json`, `README.md` and similar files before writing every brief, so the brief can
name the right build and test commands.

**Why it goes.** Past runner sessions spent two to five thousand tokens on it each time, on
Claude's side, before agy starts. agy has its own file tools and can read those files in its
own context, which is the reason to delegate at all. `commands/delegate.md` already says to
let agy inspect files rather than pre-reading the tree.

**Change.** Delete the section. Keep the brief anatomy.

## M1. Remove the AskUserQuestion model prompt

**Story.** `commands/delegate.md:27-42` and `agents/agy-runner.md:67-69` tell Claude to run
`setup.mjs --print-models` and ask the user to pick a model with AskUserQuestion when the user
mentions models, plus a second question for effort in some cases.

**Why it goes.** The default is already the newest flash model, `gemini-3.8-flash-medium` today.
A user who wants another model names it. The only real gap is a name that matches no model,
which file 3 (M2) handles by listing the valid ids.

**Change.** Remove the AskUserQuestion section and the tool from `allowed-tools` in
`commands/delegate.md` and from the runner's `tools`.

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

The exact before and after is in `diffs/p1-remove-orchestrator.diff`, made against the current
working tree. The `commands/kaizen.md` hunk also covers A5.
