# Changelog

## Unreleased

### Removed

- **The `agy-runner` subagent.** A background Bash job started inside a subagent is stopped
  when the subagent ends its turn, so the dispatch was lost in 2 of 3 eval runs: the runner
  ended its turn to wait for the notification, and Claude Code killed the still-running job
  with it. `/agy:delegate` now carries the brief-writing guidance the agent used to hold.
- **The `wander` warning.** The plugin could not tell a scratch file from a deliberate one, so
  it warned on runs doing the right thing.
- **The git checks: `--no-git-check`, the non-repository refusal, and the dirty-tree warning.**
  Delegating from a dirty tree is the normal case.
- **The before and after `git status --porcelain` snapshots, and every file count built on
  them** (the status line, `filesChanged` on papercuts, the calls-per-file ratio in
  `/agy:kaizen`). Read `git diff` for what changed.
- **The AskUserQuestion model prompt.** The model comes from the cached list; name one only
  when the user does.
- **The `--continue` fallback in `/agy:resume`.** It was machine-wide and could resume another
  repository's conversation. With no id, resume takes the newest job in this repository that
  has a conversation id, or says so and stops.
- **`--background`, `--wait`, and the `--worker` re-entry point.** One execution path: foreground
  execution under a backgrounded Bash call. `--background` detached workers and severed harness
  notifications without failing or raising errors; `--wait` was accepted and ignored. Removed
  `spawnBackground`, `forwardFlags`, the `CAD_WORKER`/`CAD_REPO_ROOT` handoff, the `background`
  field on the job record, and `--background` forwarding in `/agy:resume`.
- **Windows-only: every non-`win32` code path.** Removed `killPosix` and the platform check in
  `killTree`, the `which`-vs-`where` locator, the `detached: true` ternary on the CLI spawn, and
  POSIX/macOS handling in `args.mjs` and `paths.mjs`. `"os": ["win32"]` is declared in
  `package.json`. Comments recording verified CLI behaviour are preserved.
- **The low/medium/high effort rubric in `agy-runner.md` and `commands/delegate.md`.** It
  pre-judged on a mechanical-vs-reasoning axis that misses per-site judgement, and it displaced
  the delegating model's own read of the task. The instruction that remains is the mechanism:
  omit `--model`, pass `--effort` per task.
- **Dead exports.** `versionInfo`, `collapseArguments`, `id()`, the `isPidGone` re-export from
  `jobs.mjs`, and the identity projections `viewFromJob` and `snapshotFiles` — the job record
  already has the shape the renderer reads.

### Added

- **`/agy:update`.** Runs `agy update`, prints the `agy changelog` entries newer than the old
  version for Claude to check against this plugin's workarounds.
- **`--prompt-file <path>`.** Claude writes the brief with its Write tool and passes the path, so
  a long or quote-heavy brief never goes through the command line.
- **Warnings for agy's own print timeout, context compactions and denied actions.** agy returns
  `SUCCESS` and exit 0 when it stops at its print timeout; the stderr line was the only record.
- **A progress line from `/agy:result` on a running job**: elapsed time, tool calls, the last
  tool, and tool failures so far.
- **An `orphaned` status** for a job whose processes are gone but whose record still says
  running.
- **A model table in `/agy:delegate`**, generated from the cache, with the effort levels each
  family takes. `--model <family> --effort <level>` now works, and `--effort` is dropped with a
  note when the model cannot take it.
- **Model cache refreshes without `/agy:setup`**: weekly after a run, before a run whose
  `--model` is not cached, and after agy rejects a model. Each is awaited in the same process
  and cannot change the exit code.
- **A friction log, and `/agy:kaizen` to read it.** Every `⚠` line a run produces that is
  actually friction — `stderr`, `agy-error`, `watchdog`, `tool-errors` — appends a
  row to `~/.cad/papercuts.jsonl`. The other warnings fire on runs that worked, so
  filing them would bury the rows that matter. `/agy:kaizen` groups the log and prints it;
  `--resolve <id> --note` appends a resolution and never edits a row, so a fix that did not
  hold shows up as its cluster coming back.
- **`/agy:papercut`** — writes the one row the plugin cannot observe: `narrated` (what agy
  said blocked it, quoted). Records what happened and never why; the reading happens in
  `/agy:kaizen`, later, with fresh context.
- **`toolCalls` on the run summary.** Every tool step a run took, stamped on each papercut.
  Forty calls on a one-file task went wrong somewhere, whatever the status says.
- **The `agy --version` string is recorded in the model cache** and stamped on every papercut.
  Written by `/agy:setup`, which already resolves the binary, runs `--version` and rewrites the
  cache from a live `agy models` fetch — so the version costs no extra subprocess per dispatch.
  `--print-models` refreshes the model list and carries the stored version across untouched.
- **A resume line when a killed run kept its conversation id.** `⚠ this run can be resumed
  where it stopped: /agy:resume <id>`. Says the option exists; does not tell you to take it.

### Changed

- **`delegate.mjs` exits 1 when a run did not finish** (failed, cancelled, orphaned, killed,
  timed out, or agy status `ERROR`). It returned 0 on every finished run before, so a
  never-started run and a watchdog kill looked the same as a clean one.
- **agy's stderr prints on every run that wrote any**, not only when there was no write-up.
- **The resume offer appears on every unfinished run that kept a conversation**, not only a
  watchdog kill: over 136 recorded runs, 33 instead of 2.
- **A run that never started is recorded as `failed`**: status `ERROR` with no conversation id.
- **Short job ids resolve within this repository only.** A full job id still resolves anywhere.
- **An unknown `--model` lists the valid ids** from the refreshed cache instead of agy's display
  labels, which cannot be passed back.
- **The default timeout is 3600 s (60 m)**, up from 900 s.
- **`/agy:resume` passes through every flag it is given.** It rebuilt the command from a
  hand-picked few.
- **`splitArgString` keeps backslashes in paths.** A Windows path typed into any slash command
  lost its separators.
- **`anomalies()` returns tagged objects rather than strings.** Each warning is now
  `{id, line, detail}` instead of a prose line, so the papercut writer can record which warning
  fired without a second copy of the detection rules to drift from the first. The rendered
  output is byte-identical; `WARNING_IDS` is now relied-on in code rather than documentation-only,
  since its ids are values on the code path.
- **`⚠ agy status: ERROR` now carries the fact next to it** — whether a write-up came back,
  read from the run itself (the `result` event). agy reports `ERROR` for retryable provider
  hiccups on runs whose work landed intact, and the bare line read as a failure.
- **`--effort` now reaches the default model.** agy encodes effort in the model id, so the
  auto-pick used to resolve to `…-flash-high` and `--effort` was discarded on every run that
  did not also pin `--model` — the flag was unreachable. `pickDefaultModel` now takes the
  effort and picks within the newest flash version; the default is `medium`, not `high`.
- **Trimmed `agents/agy-runner.md` and `commands/delegate.md` by ~40%.** Removed the
  restatements of "you are a forwarder", the hedged task-size thresholds, the list of ways a
  user might signal they want a say in the model, the delegation examples, the job-registry
  path duplicated from `result.md`, and the paragraph restating the first rule of the
  contract file injected two lines below it. No instruction was dropped, only its repeats.
- **One job-directory scan in `jobs.mjs`.** `locateJobFile`, `allJobs` and `listJobs` each
  carried their own copy of the walk over `~/.cad/jobs/*/`; they now share `repoJobDirs` and
  `readJobsIn`. Every script parses its argv through `parseCommandArgv` rather than three of
  them spelling out `parseArgv(collapseCommandArgv(...))` by hand.

## 0.1.0 — first cut

Delegate coding tasks from Claude Code to the Antigravity CLI (`agy` 1.1.19). Sibling of
[cursor](../cursor/README.md) and
[grok](../grok/README.md); the CLI surface
is different enough that this plugin is written fresh against captured runs, not forked.

### Added

- **`/agy:delegate`** — hand a task to agy. Runs in the foreground of its own process under a
  backgrounded Bash call, so the session stays free and the harness announces the exit; nothing
  polls. Sidecar brief, `--add-dir` on fresh dispatch, permission bypass always on, and the
  model resolved silently to the newest, highest-effort flash from the live `agy models` list.
- **`/agy:result [job-id] [--list] [--all]`** — agy's report, or a table of tracked jobs. A clean
  run renders as the report alone; the only additions are warning lines for the ways a run can
  be wrong while agy still calls it done.
- **`/agy:cancel [job-id]`** — tree-kill the CLI child then the wrapper.
- **`/agy:resume [job-id|uuid] [follow-up]`** — `--conversation <uuid>` or `--continue`.
- **`/agy:setup`** — resolved binary, version, live model list from `agy models`.
- **`agy-runner` agent** — shapes a task into a self-contained brief and dispatches it.

### Notes on the implementation

Derived from six captured runs of agy 1.1.19 and published docs, with captured behaviour winning where the two disagree: `--add-dir` is required to prevent agy from defaulting to `~/.gemini/antigravity-cli/scratch` while reporting `status: SUCCESS` (`--project` binds cwd in neither form); `--print=<brief>` must be attached and positioned last; `--model` slugs encoding effort cannot be combined with `--effort`; `status` and exit codes disagree in both directions.

The docs say a tool needing an approval it cannot obtain is soft-denied: the run continues and exits `0`. That is untested here. Captured run `permission-denied.ndjson` refused an approval that was requested — a different state — and shows only that hard denial terminates the run with `status: ERROR` and an empty response. NDJSON carries no exit code. `--dangerously-skip-permissions` remains unconditional either way, because soft denial leaves the work silently unperformed.
