# Changelog

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
