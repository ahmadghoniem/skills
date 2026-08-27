# Changelog

## Unreleased

### Removed

- **`--background`, `--wait`, and the `--worker` re-entry point.** One run path now: the
  foreground of this process, under the orchestrator's backgrounded Bash call. `--background`
  detached a worker and severed the harness notification, so every doc already told the caller
  not to pass it — a flag whose documentation is "don't", that raises no error when passed, and
  whose failure mode is silence. `--wait` existed only to negate it. Gone with them:
  `spawnBackground`, the `CGD_WORKER`/`CGD_REPO_ROOT`/`CGD_PROMPT` handoff, the `background`
  field on the job record, and the `live` split in `runAndRecord`.
- **Windows-only: every non-`win32` code path.** `killPosix` and the platform test in
  `killTree`, the `which`-vs-`where` locator, the `detached: true` ternary on the CLI spawn, and
  the POSIX/macOS asides in `args.mjs` and `paths.mjs`. `scripts/lib/winbin.mjs` and
  `scripts/lib/invoked.mjs` were both platform shims and are folded into `run.mjs`, `grok.mjs`,
  and `args.mjs`. `"os": ["win32"]` is now declared in `package.json`.
- **`toolPaths` from `parse.mjs`.** Dead since the file list was removed from the renderer — it
  had no caller outside its own tests. `dedupePaths` and `normalisePaths` stay: they are live
  through `describeToolCall`.
- **The low/medium/high effort rubric in `grok-runner.md`.** It pre-judged on a
  mechanical-vs-reasoning axis that misses per-site judgement, and it displaced the delegating
  model's own read of the task. What remains is the mechanism: pass `--effort` per task.

### Fixed

- **A failed run explained nothing.** Grok reports a refused dispatch on stderr, and carries the
  reason a run died mid-stream in a `type: "error"` event. Both were dropped: stderr reached the
  log file and nowhere else, and `error` fell through `summariseEvents`'s switch with every other
  unrecognised type. A bad session id therefore rendered as `(no final message captured)` under a
  bare `⚠ exit 1`, with grok's own explanation — `no session id or title matched "…"` — sitting on
  disk. One `⚠ error:` line now carries it, fed by the `error` event when there is one and the
  stderr tail on a failing exit otherwise, with the spawn-error path folded into the same buffer.
  Persisted on the job record, so `/grok:result` re-renders it instead of losing it.
- **A bare `--resume` could attach to another Claude session's conversation.** It became
  `--continue`, which grok resolves as "newest session for this directory" — by directory, not by
  who dispatched. Two Claude sessions working in one repo share a job store, so the second silently
  won the race and the first answered from a conversation it never had, at exit 0 with no warning.
  Reproduced before fixing. `--continue` and `resumeLatest` are gone; every resume names its
  session, and a bare `--resume` is refused rather than guessed at.

- **Long write-ups were silently truncated at 8000 characters.** `summariseEvents` ended with a
  bare `.slice(0, 8000)`, applied at persist time, so the job record itself never held more. A
  measured run produced 26,937 characters and 8,000 were kept — 70% of a clean `end_turn` answer
  destroyed mid-word, with no ellipsis, no flag on the record, and no warning line, while
  `contract.md` promised the write-up was relayed as-is. The cut did not read as truncation; it
  read as the model malfunctioning, and the reader re-prompted twice for brevity against a model
  that had never been the problem. The discarded tail held grok's own question about the task, so
  the loop ran two extra rounds rediscovering it. The ceiling is now 256 KB — above anything
  grok's output budget can reach — and when it does fire it appends a post-flight note giving the
  real length and naming the `.ndjson` log that still holds the whole text.
- **The resume line was gated on a watchdog kill.** A kill is only one way to end with a live
  session and no clean finish: a refused resume, a non-zero exit, and a stop reason short of
  `end_turn` all leave one too, and all printed nothing. `/grok:result` had always gated on the
  job's `status` instead, so the same job rendered live and rendered later disagreed about whether
  it could be continued. Both gates now read `status`, and the line reads `did not finish cleanly`
  rather than `ended early`. Clean runs stay silent — the job id is printed at dispatch and
  `--resume=` takes it, so a ⚠ on a run that worked would be noise the contract does not allow.

- **`--help` billed a real run.** `help` was declared as a boolean flag and never read, so it
  fell through to a dispatch. It now prints usage and exits 0, checked ahead of the `--resume`
  that `/grok:resume` injects.
- **A killed run crashed instead of printing its resume line.** `foreground` read
  `freshSessionId`, a const scoped to `runAndRecord`, so rendering the outcome of a
  watchdog-killed run threw `ReferenceError` — after the work was done and the job record
  written. A clean run short-circuited past the reference, which is how it survived. The
  foreground path had no end-to-end test at all; `tests/delegate-foreground.test.mjs` now covers
  both outcomes, with a hanging stub mode for the killed one.

### Added

- **A resume line when a killed run kept its session id**, and its inverse when it did not:
  `⚠ this run did not finish cleanly — resume it with /grok:resume --resume=<job-id>` versus `⚠ no session id
  was captured — this job cannot be resumed`. Mutually exclusive, and both registered in the
  output contract.

### Changed

- **`--resume=` takes a job id and nothing else.** It briefly accepted a job id or a grok session
  uuid, while the resumable warning printed the uuid — two handles for one thing, and the one the
  plugin printed was not the one it advertised. The job id is now the only accepted form and the
  renderer prints it, so every id the plugin shows you is one it takes back and the kill hint can
  be pasted exactly as printed. The uuid stays on the job record and is still what reaches grok as
  `-r <uuid>`; it is no longer something you type. Known cost: a grok session with no job record —
  pruned at 30 days, or a `grok` TUI session this plugin never dispatched — is no longer resumable
  through the plugin.
- **Watchdog default 3600 → 4800 seconds.** It matched grok's own idle timeout exactly, so the two
  raced and a watchdog kill could pre-empt the `error` event naming the cause. Grok now fails first
  and says why.
- **Trimmed `agents/grok-runner.md` and `commands/delegate.md` by ~30%.** Removed the
  restatements of "you are a forwarder", the hedged task-size thresholds, and the paragraph
  restating the first rule of the contract file injected two lines below it. The per-run
  billing note and the "copy grok's job id, not the wrapper's" warning both stay — they are
  the only place either fact is stated. No instruction was dropped, only its repeats.

## 0.4.0 — the console window is gone, and the result block is just grok's write-up

Two changes you feel immediately: dispatching a job no longer opens a terminal window that sits
there for the life of the run, and the write-up that comes back is grok's own, without a wrapper
of facts you already had.

### Fixed

- **A console window opened on every background dispatch and stayed open.** The background worker
  is spawned `detached`, so it has no console of its own; Windows therefore handed the `grok.exe`
  it spawned a brand new one — on Win11 a Windows Terminal window titled with the binary's path,
  alive for the whole job. `windowsHide: true` was missing from every spawn that could create one:
  the CLI spawn in `lib/grok.mjs` (the load-bearing one — the window's owner was `grok.exe`
  itself), the probe spawn in `lib/run.mjs` (`--version`, `models`), and the worker spawn in
  `delegate.mjs`. `lib/killtree.mjs` already set it; these three were simply missed.

### Changed

- **The result block is grok's write-up and nothing else on a clean run.** Gone: the model id, the
  finish timestamp, `exit 0`, the cost and turn count, and a re-print of the entire prompt just
  typed (`result.mjs` echoed it unconditionally and untruncated, so a 5KB brief came back in full).
  Gone too: **Files touched**, which was built from every `file_path` grok's tools mentioned —
  reads included — so a run that read forty files and edited one listed forty-one. `git status` is
  the ground truth and is one call away.

  What survives is the set of ways a run can be wrong while still looking done, one `⚠` line each,
  any of which may fire alone: a stop reason that is not `end_turn`, a non-zero process exit, a
  watchdog kill, commands that exited non-zero (reported, never judged), and a lost session id.
  grok's own verdict and the process exit code stay separate — they disagree in both directions.

- **Dispatch is non-blocking without detaching.** The command now runs grok in the foreground of
  its own process, invoked under a backgrounded Bash call, so the session stays free *and* the
  harness announces the exit. The plugin's own `--background` detaches the worker, which severs
  that notification and leaves polling as the only way to learn the job finished; it is now
  documented as scripting-only and the command docs tell Claude not to pass it.

- **The dispatch line is one line:** ``grok `job-id` (model)``.

### Added

- `tests/render.test.mjs` — 13 tests pinning the new block, including that the prompt is never
  echoed, no file list is emitted, and a clean run produces no warnings at all. 127 tests total.

## 0.3.0 — cancel actually kills the CLI, and the prompt leaves the environment

A research pass (grok-4.6 with Exa, sourced against libuv, Node, and the CLI wrappers' own issue
trackers) turned up four defects in how this plugin starts and stops the grok child. All four are
fixed here, in a `killtree.mjs` that is byte-identical to the one in the sibling
`claude-cursor-delegate` plugin so the two forks cannot drift.

### Fixed

- **`/grok:cancel` killed the wrapper and left grok running — and billing.** The job record stored
  only the node wrapper's pid. Signalling it on Windows leaves the actual `grok` process, and
  everything it spawned, orphaned: libuv's process-wide Job Object carries
  `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK`, so grandchildren are deliberately excluded from it. The
  record flipped to `cancelled` while the billed run kept going. Jobs now record `cliPid` alongside
  `pid`, and cancel tree-kills the CLI child first, then the wrapper — in that order, because once
  the root is gone Windows can no longer enumerate its descendants.

- **The SIGKILL escalation could never fire.** Every kill path gated the escalation on
  `!child.killed`. Node sets `child.killed` when the signal is *sent*, not when the process exits,
  so after `child.kill('SIGTERM')` the flag is already `true` and the SIGKILL was dead code. A grok
  run that ignores SIGTERM was never escalated. The predicate is now
  `child.exitCode === null && child.signalCode === null`.

- **A pid that could not be signalled was read as "already dead".** The old `isProcessAlive`
  treated any throw from `process.kill(pid, 0)` as "gone". Only `ESRCH` means gone; `EPERM` means
  the pid names a live process this account cannot signal, which is common on Windows. Reading that
  as dead marks a live billed job cancelled without killing anything. `isPidGone` now checks for
  `ESRCH` specifically.

- **The prompt travelled to the background worker through the environment.** `CGD_PROMPT` carried
  the whole brief in the child's environment block. The prompt now lives on the job JSON, written
  at `createJob` and read back by the worker — the worker's argv is ids and flags only. `CGD_PROMPT`
  is still read as a fallback for one release so a worker spawned by 0.2.0 is not broken.

### Changed

- On POSIX the grok child is spawned `detached: true` (without `unref()`, since we still wait on
  `'close'`) so it leads its own process group and the tree kill can signal `-pid`. On Windows it
  stays inside libuv's job and `taskkill /T /F` walks the tree instead.
- `taskkill` is invoked by absolute path with `shell: false`. This is mandatory, not stylistic:
  under Git Bash, MSYS rewrites `/PID` into `C:/Program Files/Git/PID` and the kill silently does
  nothing. Exit code 128 is read as "process not found" rather than matching on stderr, which is
  localised.
- Both readline interfaces are drained before the run is summarised.
- `/grok:cancel` now reports which of the CLI and wrapper pids were already gone, instead of
  claiming a kill that did not happen.

### Tests

114 passing, up from 104.

## 0.2.0 — cancel, resume, setup, and a test suite

### Added

- **`/grok:cancel [job-id]`** — SIGTERM, then SIGKILL after 5s. With no id it resolves the single
  running job, refuses when several are running, and says so plainly when there are none.

  It also handles the case the cursor original does not: a record whose recorded `pid` names no
  live process. The watchdog lives inside the parent node process, so killing that parent strands
  the record at `running` forever with nothing to signal it — 0.1.1 left two such records behind
  during its own testing, and there was no way to clear them. `cancel` now detects the dead pid
  (`ESRCH`) and reaps the record, reporting that the process was already gone rather than
  pretending a kill happened.

- **`/grok:resume [--resume=<id>] [follow-up]`** — continue the latest grok session for this
  repository, or a named one. A nine-line wrapper that injects `--resume` and hands off to
  `delegate.mjs`, so there is exactly one run path and one job-recording path.

- **`/grok:setup`** — resolved binary, version, login state, available models. `--print-models`
  prints just the ids for programmatic use.

  This is built on `grok models`, which exits 0 and reports both auth state and the model list.
  (`grok doctor` is unrelated — terminal, clipboard and microphone diagnostics, nothing about
  authentication.)

- **A vitest suite: 104 tests across 10 files**, weighted toward argv and flag parsing, which is
  where every defect found in this plugin so far has lived. `parse.mjs` fixtures are trimmed from
  real captured NDJSON runs rather than invented, so they cannot drift from what grok actually
  emits.

### Fixed

- **Argv handling no longer guesses which caller it has.** 0.1.1 inferred it from token count —
  more than one token after `--` meant a shell had already split it. That left a hole: a Bash call
  with exactly one token (a bare prompt, no flags) still got split and re-joined, flattening
  newlines and collapsing runs of whitespace, so a structured multi-line brief arrived as one line.

  Argv is now returned untouched unless the new `--arg-string <blob>` marker is present. That
  marker is the only input that genuinely has never been through a shell — Claude Code hands
  `"$ARGUMENTS"` over as a single string. The caller declares which it is; nothing is inferred.

- **A killed run no longer offers a session it cannot resume.** `end` is the only streaming event
  carrying `sessionId`, and a watchdog kill never receives it — verified against a real killed
  run's raw log. The foreground write-up used to print a `--resume=…` line pointing at nothing;
  it now says the session was lost.

### Changed

- `isProcessAlive` and `isPidGone` were exact inverses of each other. Collapsed into one.

### Upstream

- All four of 0.1.1's fixes, plus this release's argv marker, were backported to
  [claude-cursor-delegate](https://github.com/ahmadghoniem/claude-cursor-delegate) 0.10.0, which
  had inherited the same defects. The argv bug had shipped past that repo's 108-test suite,
  because its coverage only ever fed `collapseCommandArgv` single-string input — the one shape
  where the old code was correct.

## 0.1.1 — fixes from the full end-to-end pass

Running every command and flag against real dispatches turned up three defects the first cut's narrower testing missed.

- **`--prompt-file` with a space in the path now works.** `collapseCommandArgv` re-joined and re-split argv the shell had already split, tearing `C:/Users/Ahmed Ibrahim/brief.md` into two tokens; the stray fragment landed in `positional` and the run died on the misleading "pass the task either on the command line or via `--prompt-file`, not both". It affected every path containing a space, which on Windows is most of them. Argv is now passed through untouched when the shell has already split it; a single `"$ARGUMENTS"` string still collapses, which is the one case that needs it. Found by the `grok-runner` agent hitting the error during its own test dispatch and diagnosing it rather than working around it.
- **`/grok:result --all` on its own lists jobs.** It previously only took effect inside the `--list` branch, so a bare `--all` silently printed a single job's record instead — same output shape, different content, nothing to signal the flag was ignored. `--all` now implies `--list`.
- **`/grok:result` no longer double-spaces** before the summary heading.

Note: `claude-cursor-delegate` carries the same `collapseCommandArgv` and therefore the same argv bug.

## 0.1.0 — first cut

Forked from [claude-cursor-delegate](https://github.com/ahmadghoniem/claude-cursor-delegate) 0.9.0. The job registry, argument parser, background worker, and job-table renderer are backend-agnostic and carried over unchanged; everything that touches the CLI is new.

### Added

- **`/grok:delegate`** — hand a task to the Grok Build CLI. Blocks and prints the result inline by default; `--background` returns immediately and records the job. Supports `--model`, `--effort`, `--resume[=id]`, `--fresh`, `--timeout`, `--prompt-file`, `--no-git-check`.
- **`/grok:result [job-id] [--list] [--all]`** — the job's full record, or a table of tracked jobs (running ones included, so it recovers the id of a `--background` job).
- **`grok-runner` agent** — shapes a task into a self-contained brief and dispatches it.
- **Failed-command reporting.** Grok's stream carries an exit code for every terminal command it runs, so the result lists the non-zero ones with their output. Deliberately *not* fatal: a non-zero exit is routinely intentional (`grep` finding nothing, a red test in a TDD cycle), so job status still comes from grok's own stop reason. This earned its place on the very first end-to-end run, where grok's summary read as a success while three commands had in fact exited 1.
- **Cost reporting.** Grok bills per run and reports the figure in its terminal event.

### Notes on the implementation

- **The parser is written against a captured run, not the docs.** `grok --help` describes `streaming-json` as "NDJSON of the agent native ACP session updates", which would mean `{method:'session/update', …}` envelopes. Real runs emit flat `{type, …}` objects instead — `text`, `thought`, `tool_call`, `tool_call_update`, `usage`, `end`. Unknown event types are ignored rather than treated as errors so a future grok release does not break a run.
- **The brief goes via `--prompt-file`, never argv** — out of the host process list, unbounded by the OS argument-length cap, and a brief starting with `-` cannot be misread as a flag.
- **`--always-approve` is unconditional and has no opt-out.** A headless run cannot answer an approval prompt, so without it grok stalls. The guard against a bad edit is that this plugin never commits and a human reads the diff.
- **`--sandbox` is never passed.** Grok accepts an unknown profile name silently and runs anyway (verified: `--sandbox __invalid__` produced no error and no refusal), so it reads like a guarantee while providing none — worse than no guard at all.
- **No hardcoded default model.** `grok models` is consulted and the newest id wins, cached for a day, falling back to a pin only when that list cannot be read. A default pinned in the docs goes stale the moment xAI ships the next model — which is exactly what happened to the sibling plugin's `composer-2.5-fast` claim.
- **`grok models` is not usable as a health check** — it prints `You are not authenticated.` on a working authenticated install. `grok --version` is used instead.
- **The binary is looked up at `~/.grok/bin` when it is not on `PATH`.** The installer appends its directory to the *persistent* user PATH, so a Claude Code session started before the install will not see it. This is not hypothetical; it is what happened on the machine this plugin was built on.
- **File paths are normalised against the repo root.** Grok reports the same edit as a relative path from one event and an absolute one from another, which made a one-file change render as two.

### Not yet included

`cancel` and `resume` as standalone commands, and the vitest suite. Path helpers and both end-to-end flows were verified by hand against real dispatches.
