# Changelog

## Unreleased

### Added

- **A `bash` tool for agy.** `mcp/bash.mjs` serves Git Bash over MCP: it runs in the
  foreground until the command ends (up to 20 min), where agy's own `run_command` runs
  PowerShell and backgrounds anything over 10 s. `delegate.mjs` and `/agy:setup` register
  it as the `agy` server in `~/.gemini/config/mcp_config.json`, keeping the other servers,
  and rewrite the entry only when its path or settings change. The model sees it directly
  as `mcp_agy_bash`. The global config reaches resumed conversations too, which a per-run
  `--add-dir` does not.
- **`apply-patch` in the bash tool.** The repo's `tools/apply-patch` runs as the
  `apply-patch` bash function. After a patch that applies, the tool appends the diff of
  that call's changes.
- **The bash tool cuts long output itself.** Past 9,000 characters it keeps whole lines
  from both ends and notes which lines are missing, how many `rg` matches each file had
  in them, and where the full output is saved. agy dropped the middle of 19% of bash
  results with only a file link, which the model never opened. The note also counts
  `rg` output without line numbers, `-C` context lines, single-file matches and listings
  with root files; when the command only printed a file, it names the file's missing
  lines for `view_file`. The tool's `rg` adds `--max-columns=300 --max-columns-preview`
  to the user's rg config when it lacks them.
- **Labelled sections are cut one by one.** Output split by `== <label>` lines shares the
  9,000 characters between sections, so one long result no longer hides the others.
  `agy-chore` is told to run independent searches in one bash call this way: the model
  made one tool call per turn, and in 5 lookups turns fell from 294 to 176 with recall
  unchanged (0.61 against 0.62).
- **The agents read with `view_file`.** `agy-chore` and `agy-delegate` are told to read
  files with `view_file` (800 lines, not cut) rather than `cat` or `sed`, and in one large
  window rather than slices: a third of file reads in a benchmark re-read a file already
  read.
- **`--chore`** runs the new `agy-chore` agent: it investigates, runs scratch scripts in
  a `mktemp -d` directory, reports with `path:line` citations, and is told not to change
  the workspace. Defaults to `low` effort.
- **`--read <path[:from-to]>,...`** puts the files, numbered and wrapped in
  `<file path="...">`, in a chore's first message. Paths are checked before anything runs.
- **Runs on Linux.** The bash tool defaults to `/bin/bash`, agy is looked up with `which`
  and then at `~/.local/bin/agy`, and a timeout or cancel kills the whole process tree
  with SIGKILL. Checked on Ubuntu 24.04 (WSL): unit tests, tree kills, bash tool timeout.
- **`evals/bench/`** runs stock agy and the `agy-chore` agent on the same tasks, with a
  setup script and first-session checks for a Claude Code cloud environment.

### Changed

- **Papercuts are grouped by key.** Each row now carries a `key` (the warning id, or
  `tool-errors:<tool>` with one row per failing tool) and its `text` is the failure
  itself, not the `⚠` heading. `/agy:papercut --resolve <key>` closes a whole group;
  `--resolve <id>` still closes one cut. `/agy:update` prints one block per key with
  its distinct messages. Rows drop `severity`, `tool` and the `evidence.detail` copy.
  A failure in one tool no longer counts as a recurrence of a fix to another.
- **One agent.** `agy-delegate` now has only `view_file`, `search_web` and
  `read_url_content` of its own, plus the bash tool, and edits files with `apply-patch`.
  agy still loads `AGENTS.md` and `GEMINI.md` itself; `excludeDefaultComponents` does
  not stop it.
- **Rules are no longer inlined.** The first message held the repo's `AGENTS.md` (or
  `CLAUDE.md`), which agy had already loaded on its own. Now a task job whose repo has a
  `CLAUDE.md` and no `AGENTS.md` or `GEMINI.md` gets a one-line pointer to it; a chore
  gets none.
- **The message goes on stdin.** A fresh job sends an environment note and the brief as one
  `--input-format stream-json` line, instead of a `--print` instruction to read a file.
  Measured: 11 to 13 model calls and 140k to 148k input tokens, against 14 to 15 and 180k.
  A message over 150,000 chars still goes through the file. `--disable-slash-commands`
  is always passed.
- **Default model `gemini-3.7-flash`** at the requested effort, while agy lists it,
  instead of the newest flash. 3.8 used 1.4 to 3.2 times the input tokens.
- A task whose first word is longer than 40 characters no longer fails on a job file
  name too long to open.

### Removed

- **`--read-only`**, the `agy-delegate-readonly` agent and the `read-only` warning.
- **`CAD_AGY_AGENT=default`**, which ran agy's own agent instead of `agy-delegate`.

## 0.3.0 (agy 1.2.11)

Checked against agy 1.2.11.

### Added

- **Two custom agy agents.** Fresh dispatches run `agy-delegate`; `--read-only` runs
  `agy-delegate-readonly`, which has no file-writing tools. `delegate.mjs` installs them
  into `~/.gemini/config/agents/` when missing or changed, since `--agent` with an unknown
  name silently runs the default agent. The first call drops from 13.1k to 10.4k input tokens.
- **A `read-only` warning.** Shell commands still run under `--read-only`, so the plugin
  compares `git status` before and after the run and lists what changed.
- **An update notice.** `/agy:delegate` checks GitHub for the latest agy release once a
  day, alongside the run, and ends its output with a line when one is newer than the
  installed agy. agy's own auto-update stays off.

### Changed

- **`/agy:update` reviews the papercuts.** It prints the open clusters after the changelog
  (also when agy is already current) and refreshes the model cache after an update.
  `--resolve` moves to `/agy:papercut`.
- **`/agy:setup` no longer lists the models.** `/agy:delegate` already embeds the family
  table, and the weekly refresh keeps the cache current.

- **`/agy:update` reads the upstream changelog.** `agy changelog` in 1.2.11 still stopped at
  1.2.2, so the update reported nothing new. It now reads the CHANGELOG.md in
  `google-antigravity/antigravity-cli` and falls back to `agy changelog`. Both header shapes
  (`## 1.2.11`, `1.2.2:`) parse.
- **`/agy:update` waits up to 15 minutes for the download.** The 120 s limit killed a 2m50s
  download of the ~200 MB binary. The command now runs the script as a background Bash call
  instead of a `!` preamble, which Claude Code moves to the background after 120 s anyway.
- **Exit 3 counts as unfinished.** agy 1.2.6+ exits 3 when a turn ends on a model or agent API
  error, including after a partial response; the run now gets the resume offer.
- **The `Valid ids:` list shows only for an unknown model**, not for an `--effort` mismatch,
  where agy's own message already names the levels the model has.
- **Docs: `--continue` is per workspace since agy 1.2.1**, not machine-wide. Verified: from a
  second directory it resumed that directory's conversation, not the newer one elsewhere.
- **Docs: an `ERROR` status no longer implies a run agy retried and completed.** Since 1.2.1
  agy retries transient API errors in-process, so `ERROR` is a run that ended on an error; the
  diff still comes first, since work before the error stays in the tree.

### Removed

- **`/agy:kaizen`.** agy releases about four times a week, so reviewing the papercuts on
  each update replaces the separate review. The `--all`, `--kind` and `--since` filters go
  with it.
- **The `output-contract` skill.** Its only automatic consumer was the retired `agy-runner`
  agent, and Claude never invoked it; the commands include the contract directly. The text
  moves to `contract.md` at the plugin root, and Claude's skill listing loses about 52 tokens
  per request.
- **`resolveEffort` and its dispatch note.** It dropped `--effort` for models that take no
  levels (the Claude models agy offers). agy now refuses the mismatch with an error that names
  the levels the model has, so the plugin no longer special-cases those models. `--effort` is
  still dropped when the model id already encodes a level.

## 0.2.0

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
  actually friction — `stderr`, `agy-error`, `watchdog`, `timeout`, `tool-errors` — appends a
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
  `--print-models` reads that cache, and refreshes it only when it is missing or empty.
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
- **Trimmed `commands/delegate.md` by ~40%.** Removed the
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
