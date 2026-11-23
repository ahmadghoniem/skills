# Changelog

## Unreleased

### Added

- **A native agy plugin.** The `bash-delegate` agent and its bash tool now reach agy as one
  plugin, `agy`, installed with `agy plugin install` when the installed copy is missing or
  differs, instead of a copied agent file and an entry patched into the global
  `mcp_config.json`. The bash server still points at this checkout, so edits to it are
  live. The tools are now `mcp_agy_shell_bash` and `mcp_agy_shell_bash_bg`. The old global
  agent copy and `agy` server are removed once the plugin is in.
- **`bash_bg` and the timeout handoff.** `mcp/bash.mjs` now serves `bash_bg`, which runs a
  command as an agy background task (`background: "always"`); agy sends its output to the
  model when it exits, and a headless run waits for it before exiting. A `bash` command
  still running at its timeout is no longer killed: it becomes a job that `bash_bg` with
  `job` takes over. The agent also gets agy's `manage_task`, to stop a task that does not
  exit on its own.
- **`⚠ agy ended the turn early: finished_reason <reason>`** (`finished-reason`). agy
  puts a `finished_reason` in its result when a turn ends early; any value other
  than `print_timeout` (`interrupted`, `error`) is shown verbatim, and the run counts as
  unfinished.
- **The plugin records the agy version it was reviewed against** as `engines.agy` in
  package.json. `/agy:setup` fails on an older agy. `/agy:update` prints the changelog
  since that version and then sets it to the version it installed. A test fails while the
  installed agy is newer, so an agy updated some other way is caught.

### Changed

- **apply-patch reports every failed block at once**, numbered, instead of stopping at
  the first; it still writes nothing. Over Gemini 4's patches the per-block failure rate
  was flat (about 1.9%) and big patches failed mostly by finding their bad blocks one
  retry at a time: 15 streaks of repeated failures cost 26 extra failed turns. It also
  accepts three marker slips (a second `=======` just before `>>>>>>> REPLACE`, a bare
  `>>>>>>>`, a stray `<<<<<<< SEARCH` before a header) and refuses a Create or Append
  whose text holds a leftover `>>>>>>> REPLACE`, which had silently gone into 3 files.
  Same file as Claude Code's (`tools/apply-patch`), where the same changes prevent 6 to 7
  failures in 3,358 calls and the git-conflict case stays refused.
- **agy's apply-patch is best-effort.** The bash tool's `apply-patch` now runs
  `mcp/apply-patch-partial.mjs`: the blocks that match are written, the error lists the
  ones that failed, and it exits 1, so a check chained with `&&` does not run. A kept
  `--file` patch is rewritten to hold only the failed blocks. A retry then resends only
  those, not the whole patch: about 178k output tokens of good blocks were resent across
  the 77 jobs' failed patches. Claude Code keeps the all-or-nothing `tools/apply-patch`,
  which cannot reach this file: there best-effort would break re-running a kept `--file`
  patch (17 of 20 big retries) and checks chained with `;`.
- **`mcp/apply-patch.mjs` is a symlink to `tools/apply-patch/apply-patch.mjs`**, not a
  copy, so the two cannot drift (`core.symlinks=true` in this repo; a test fails if a
  checkout turns the link into a text file). The shared file now reads a git conflict in
  a block as text, resolves `/tmp/...` and `/c/...` paths through Git Bash's `cygpath`,
  and retries a write a Windows watcher blocks. The bash tool resolves patch paths the
  same way for its `+A/-B` counts.
- **The agent is told how to chain a check after a patch**:
  `apply-patch <<'PATCH' && <check>` on the first line, so the check runs only when the
  patch applied. It chained 16 times on its own in 354 patches, always with a newline
  after `PATCH`, which runs the check even when the patch failed.
- **A patch reports one line per file instead of a diff.** After apply-patch prints ok,
  the bash tool folds its per-block lines into one line per updated file, with the lines
  each block landed on and the lines added and removed
  (`updated  src/a.ts: 2 blocks (lines 7, 32), +6/-0 lines`), the way agy's own
  `edit_file` reports. The counts come from the file read just before and just after the
  call (`mcp/patch-summary.mjs`), so no `git diff` runs. The full diff was added on
  2026-09-30 for Gemini 3.7 Flash, which spent a turn on `git diff` after 17 of 22
  patching runs. Gemini 4 re-read an edited file mid-work 0 times in 62 `edit_file`
  edits that came with only a one-line summary. The diff averaged about 4,960 bytes a
  patch, about 1.15% of all context tokens over 77 jobs, and was itself cut in 43% of
  patch calls. The per-file line is built by the bash tool, so Claude Code's apply-patch
  output keeps its per-block lines.
- **The bash tool starts Git's `usr/bin/bash.exe` directly**, with the environment Git's
  `bin/bash.exe` launcher would set (`MSYSTEM`, `EXEPATH`, `PLINK_PROTOCOL`, `HOME`, and
  `mingw64/bin`, `usr/bin`, `~/bin` at the front of `PATH`). Skipping the launcher cut a
  call from about 66 ms to 46 ms (60 calls x 3 rounds). The bash environment is
  identical whether agy inherits Git Bash's environment or a plain Windows one, and a
  cancel still kills the command's child processes. `AGY_BASH` still overrides the
  shell, and is passed the unchanged environment.
- **The print timeout is read from `finished_reason: print_timeout`.** agy's stderr notice
  still supplies the duration.
- **One agent, `bash-delegate`.** It replaces `agy-delegate` and `agy-chore`. Installing
  it removes the old `agy-delegate.md` and `agy-chore.md` from
  `~/.gemini/config/agents/`.
- **Trimmed rules:** the agent no longer carries the rules on unreadable files, searching
  before calling code unused, reading the defining line before stating a value, staying
  inside the workspace, git commands that change the tree, and package managers. The
  trimmed agent tied stock in the benchmark (2026-11-14).
- **The environment note gives the OS and workspace** (`OS: Windows (shell: Git Bash,
  through the bash tool)`, `Workspace: <path>`)
  above the git line. `excludeDefaultComponents` drops agy's `user_information`, and
  `read_file` takes only absolute paths: Hydrogen passed relative ones in 1 of 6 runs
  (2026-11-14).
- **`read_file`, not `view_file`.** agy 1.5.8 resolves `view_file` to `read_file` (listing
  both fails with a tool-name conflict), so the agent and the bash tool's cut notes name
  `read_file`.
- **Rules written for 3.8 Flash are gone:** view files up to 800 lines whole and longer
  ones 300 lines at a time; never view lines already seen. Flash ignored the first, and
  Hydrogen, which followed it, read about 50k tokens of whole files on one task where
  stock read ranges after `rg`.
- **The agent batches independent searches again** with `echo '== <label>'`, one bash
  call for several lookups. Dropped with the Flash rules, it was retested on Hydrogen in a
  paired benchmark (7 tasks rebuilt from real jobs, 11 pairs over 2 rounds, 2026-11-21):
  25% fewer turns, 30% fewer cached tokens and 32% fewer safety checks, lower in all 11
  pairs, and 23% less job time, lower in 10 of 11. Passes were 4 against 4: one task
  passed only without the rule and one only with it.
- **The bash tool measures its 9,000 budget in UTF-8 bytes**, as agy does. CJK output
  under 9,000 characters (24 KB) used to pass whole and then lose its middle to agy's own
  cut, with agy's note instead of ours. ASCII output is unchanged.
- **The README describes agy's safety check**: about 1.3 s
  on every bash call, which no MCP tool can skip, and agy's cut at about 10 KB in bytes.

### Removed

- **The whole `docs/` directory** (`parallel-calls.md` was its only page). Standalone docs
  drift; stale claims in them mislead the coding agent more than the absence would. The
  README carries what belongs in the repo, and the session transcripts keep the
  measurements.
- **`--effort` and the plugin's model picking.** The default is `gemini-4-hydrogen-medium`;
  `--model` takes a full id from `agy models`, which carries the effort level, and goes to
  agy as given. agy checks it and names the valid levels or ids. `--effort` is refused
  with a pointer to `--model`. The pre-run refresh for an uncached `--model` is gone.
  `--print-models` prints one id per line.
- **The watchdog** that killed agy 60 s after its `--print-timeout`, and its `⚠ watchdog`
  line. It fired 9 times in October, when agy hung after its timeout; agy 1.5.0 and
  1.5.8 fixed headless runs that never exited. `/agy:cancel` still stops a run.
- **The `⚠ agy skipped N actions` line** (`denied`). The plugin bypasses permissions, and
  it never fired in any recorded job.
- **The `view_file` `toolAction`/`toolSummary` rule** from `bash-delegate`. agy no longer
  requires them, and on 2026-11-11 it rejected them on image reads.
- **The working directory and the per-job scratch directory from the environment note.**
  The note keeps only its git line, which agy gives no agent and which stopped `git log`
  searches on one-commit clones. agy already gives `bash-delegate` the working directory. In six
  `bash-delegate` runs without the note (Hydrogen and 3.8 Flash at medium, 2026-11-13),
  no run left a file in the workspace: the models wrote scripts inline, and 3.8 Flash put
  its one script file in `/tmp`. The "scratch wander" this guarded against was recorded on
  3.7 Flash.
- **`--chore`, `--read` and `agy-chore`.** An investigation is now an ordinary brief. The
  120-word citation report went with them.
- **`evals/bench/`**, the ContextBench and recall benchmark harness, and `docs/pickup.md`.
- **Linux support.** The plugin is Windows only: `resolveBin` no longer tries `which` or
  `~/.local/bin/agy`, `killTree` no longer has a POSIX path, and `package.json` lists
  `win32` alone.

### Fixed

- **The bash tool runs in the workspace when agy starts it elsewhere.** A plugin's MCP
  server starts in the plugin's folder, not the workspace, so commands and patches ran
  there. Unless `AGY_BASH_CWD` is set, `mcp/bash.mjs` now asks agy for its workspace
  through MCP `roots/list` and uses the first root, waiting up to 3 s for the answer
  before it lists or runs the tool.
- **apply-patch ships with the plugin.** The bash tool ran `tools/apply-patch` from the
  repo root, which an install copied from GitHub does not include.
  `mcp/apply-patch.mjs` is now a copy of it; update both when apply-patch changes.

### Changed

- **apply-patch errors say how to fix the patch.** A SEARCH that is not found now names
  the first differing line and prints the closest span of the file; a SEARCH that matches
  more than once names, for each hit, the nearest line that tells the hits apart; a
  missing file prints the cwd and the one existing path it probably meant. Synced from
  `tools/apply-patch`.

## 0.4.1

### Changed

- **No pointer to `CLAUDE.md`.** A task job's environment note named the repository's
  `CLAUDE.md` when there was no `AGENTS.md` or `GEMINI.md`, so agy read the whole file.
  Claude now puts what the task needs from it in the brief, as with grok. agy still loads
  `AGENTS.md` and `GEMINI.md` itself; it has no switch for those.

## 0.4.0 (agy 1.4.6)

Checked against agy 1.4.6.

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
  in them, and where the full output is saved for a week, or for good in
  `AGY_BASH_KEEP_DIR` when a benchmark sets it. agy dropped the middle of 19% of bash
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
  the job's scratch directory, reports with `path:line` citations, and is told not to
  change the workspace. Defaults to `low` effort.
- **A scratch directory per job.** `delegate.mjs` creates `<job>.scratch` next to the job
  record and names it in the first message, as agy's default prompt does with
  `brain/<conversation-id>/scratch/`. The plugin's agents leave that prompt out, so
  `agy-chore` was told to run `mktemp -d` first; in a 60-run benchmark it made 71 such
  calls and almost never wrote anything there.
- **`agy-chore` cites tests only when asked, and names gaps only in what was asked.** In
  60 ContextBench runs, 31% of the spans outside the gold context were tests, and the
  closing "what I did not check" section never named a file the agent had missed. It is
  also told to search a file whose matches a cut note hid (3 runs lost a gold file that
  way) and, as an example of batching, to search every name the task mentions in one call.
- **`agy-chore` has no web tools.** After the batching example above, 13 of 60 benchmark
  runs called `search_web` (212 calls) and `read_url_content`, looking up the upstream
  issue and fix; those runs took 139 s on average against 28 s for the rest. It now has
  only `view_file` and the bash tool, and the example says to search the workspace with
  `rg -n`.
- **`agy-chore` searches git history only when asked, and stays in the workspace.** In
  the next 60 runs it made 85 `git log`/`git show` calls (7 in the first 60), many with
  `--grep` for the issue number, on one-commit benchmark clones where none could find
  anything; some runs also ran `find /`. The environment note now says when a repository
  has one commit or is a shallow clone. The tests rule names test file patterns and
  fixtures, after `*.test.js` files and fixtures kept being cited.
- **`agy-chore` views files whole and does not re-read.** Its median `view_file` window
  was 35 lines, and 70% of a re-read window had already been shown, while every earlier
  view was still in its context. It now views a file of up to 800 lines whole, a longer
  one 300 lines or more at a time, and never views lines it has seen. It is also told
  not to run or import the workspace's code, after `python -c` imports left
  `__pycache__` folders in 2 of 20 benchmark repos.
- **`agy-chore` keeps its explanation under 120 words.** In a 24-run benchmark per arm
  (8 ContextBench tasks, `gemini-3.8-flash-low`), the brief line "Keep your explanation
  before the <CONTEXT> block under 120 words." cut mean wall time from 28 s to 21 s,
  tool calls from 8.6 to 6.7, views from 5.0 to 4.1 and output tokens from 1083 to 710,
  with file F1 0.833 against 0.840. The agent file states the same limit, with the
  citation list in place of the `<CONTEXT>` block.
- **`--read <path[:from-to]>,...`** puts the files, numbered and wrapped in
  `<file path="...">`, in a chore's first message. Paths are checked before anything runs.
- **Runs on Linux.** The bash tool defaults to `/bin/bash`, agy is looked up with `which`
  and then at `~/.local/bin/agy`, and a timeout or cancel kills the whole process tree
  with SIGKILL. Checked on Ubuntu 24.04 (WSL): unit tests, tree kills, bash tool timeout.
- **`evals/bench/`** runs stock agy and the `agy-chore` agent on the same tasks, with a
  setup script and first-session checks for a Claude Code cloud environment.
  `evals/bench/recall.mjs` scores a results dir: recall against reference answers,
  broken citations, answered time, time until exit and model turns. Stock results now
  keep agy's own `duration_seconds` as `agyDuration`, since stock agy can sit idle after
  answering until `--print-timeout` (one Sonnet 5.5 run answered at 117 s and exited at
  903 s).

### Changed

- **No time limit by default.** A run used to stop at 60 minutes (agy's `--print-timeout`,
  plus a watchdog 60s later), cutting off work in progress. Without `--timeout` the plugin
  now passes no `--print-timeout`, agy's own default of waiting for the turn to end, and arms
  no watchdog. `--timeout <sec>` sets both as before.
- **One record per job.** A job folder now holds only `<job>.json`, `<job>.agy.log`
  and the scratch directory; agy's brain transcript, written as the run goes, is the
  record of the conversation. The job record now stores the `agent` it ran.
  `/agy:result` on a running job reads its progress line (tool calls, last tool,
  tool failures) from the brain transcript, and the bench and evals read brain too.
  `build-fixtures.mjs` now rebuilds only the `live-*` fixtures and keeps the
  recorded ones.

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
- **The bash tool accepts `toolAction` and `toolSummary`.** gemini-3.8-flash often adds
  them, as agy's own tools require, and the tool's schema rejected the call, costing a
  turn: 10 of 24 benchmark runs had one. Both are now optional and ignored; in the next
  8 runs, 6 of 17 bash calls carried `toolAction` and none was rejected.
- **A run stops if the bash tool cannot be installed.** It used to print a warning and
  start agy anyway, leaving both agents with `view_file` only. Now the job is marked
  failed with the reason and agy is not started.
- A task whose first word is longer than 40 characters no longer fails on a job file
  name too long to open.
- The tool-call count no longer counts each call twice. agy sends a step update when a
  tool starts and another when it ends; the count now goes by step index.
- **`agy-chore` writes the full workspace-relative path in every citation**, repeated
  ones included, and no longer pipes searches into `head`. On five Plannotator lookups,
  bare names such as `App.tsx:12` cost 0.12 of recall on one task, and `| head` hid
  matches the model then marked as inferred. The bash tool's own cut says what it left out.
- **Stderr lines that repeat another cut are no longer filed again.** agy prints its
  print-timeout notice and its error on stderr as well, so each such run was logged under
  `stderr` and again under `timeout` or `agy-error`: all 8 `stderr` cuts on agy 1.3.2 were
  copies. The `⚠ agy wrote to stderr:` line still shows every line.
- `/agy:papercut --resolve` accepts a cut id made only of digits (`26570058`), which the
  argument parser had turned into a number.
- **Docs: `--agent` with an unknown name fails the run since agy 1.3.4** (status `ERROR`,
  exit 1, the available agents listed) instead of running the default agent. The agents are
  still installed before every fresh dispatch: agy finds custom agents only in
  `~/.gemini/config/agents/`.
- **Docs: a model family passed without `--effort` runs at agy's default level** for that
  model since agy 1.3.4, instead of failing.

### Removed

- **Event logs and `.done` markers.** Jobs no longer write `<job>.ndjson` (the raw
  event stream, which duplicated the brain transcript) or `<job>.done`, which
  nothing read. `rawLogPath` and `jobDonePath` are gone from `jobs.mjs`, and
  `runHeadless` no longer takes `logPath`.

- **The prompt file route.** A message over 150,000 characters, which agy would
  cut short on stdin, used to be written to `<job>.prompt.md` and passed as
  `--print=Read the file at …`. It now fails the job before agy starts; the
  longest of 494 recorded jobs was 15,466 characters. `sidecarPrint`,
  `promptPath` and `buildArgs`'s `print` option are gone.

- **Pruning of old jobs.** Every dispatch deleted the repo's job files older than 30
  days, raw event streams included. Job records, prompts, logs and scratch directories
  are now kept until removed by hand: they are the record of each run's tool calls.
  Live evals (`AGY_EVAL_LIVE=1`) likewise copy their job folders to `~/.cad/eval-jobs/`
  before deleting the throwaway repo.
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
