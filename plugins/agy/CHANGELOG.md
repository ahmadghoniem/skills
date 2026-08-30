# Changelog

## Unreleased

### Removed

- **`--background`, `--wait`, and the `--worker` re-entry point.** One run path now: the
  foreground of this process, under the orchestrator's backgrounded Bash call. `--background`
  detached a worker and severed the harness notification, so every doc already told the caller
  not to pass it — a flag whose documentation is "don't", that raises no error when passed, and
  whose failure mode is silence. `--wait` was accepted and ignored outright. Gone with them:
  `spawnBackground`, `forwardFlags`, the `CAD_WORKER`/`CAD_REPO_ROOT` handoff, the `background`
  field on the job record, and `--background` forwarding in `/agy:resume`.
- **Windows-only: every non-`win32` code path.** `killPosix` and the platform test in
  `killTree`, the `which`-vs-`where` locator, the `detached: true` ternary on the CLI spawn, and
  the POSIX/macOS asides in `args.mjs` and `paths.mjs`. `"os": ["win32"]` is now declared in
  `package.json`. Every comment recording verified CLI behaviour stays — that is the expensive
  knowledge here.
- **The low/medium/high effort rubric in `agy-runner.md` and `commands/delegate.md`.** It
  pre-judged on a mechanical-vs-reasoning axis that misses per-site judgement, and it displaced
  the delegating model's own read of the task. The instruction that remains is the mechanism:
  omit `--model`, pass `--effort` per task.

### Added

- **A resume line when a killed run kept its conversation id.** `⚠ this run can be resumed
  where it stopped: /agy:resume <id>`. Says the option exists; does not tell you to take it.

### Changed

- **`⚠ agy status: ERROR` now carries the facts next to it** — whether a write-up came back and
  how many files changed, both read from the run itself (the `result` event, and two
  `git status --porcelain` snapshots). agy reports `ERROR` for retryable provider hiccups on
  runs whose work landed intact, and the bare line read as a failure.
- **`--effort` now reaches the default model.** agy encodes effort in the model id, so the
  auto-pick used to resolve to `…-flash-high` and `--effort` was discarded on every run that
  did not also pin `--model` — the flag was unreachable. `pickDefaultModel` now takes the
  effort and picks within the newest flash version; the default is `medium`, not `high`.
- **Trimmed `agents/agy-runner.md` and `commands/delegate.md` by ~40%.** Removed the
  restatements of "you are a forwarder", the hedged task-size thresholds, the list of ways a
  user might signal they want a say in the model, the delegation examples, the job-registry
  path duplicated from `result.md`, and the paragraph restating the first rule of the
  contract file injected two lines below it. No instruction was dropped, only its repeats.

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

Written against six captured runs of agy 1.1.19, alongside the published docs. Where the two
disagree the captured behaviour wins, but the docs are the starting point and are mostly right.
In particular: `--add-dir` is mandatory or agy reuses the persistent default CLI project rooted
at `~/.gemini/antigravity-cli/scratch`, writes there, and still reports `status: SUCCESS`
(`--project` binds the cwd in neither of its forms); `--print=<brief>` must be attached and
last; `--model` slugs that encode effort cannot be combined with `--effort`; `status` and the
process exit code disagree in both directions.

On permissions the docs say a tool requiring approval **it cannot obtain** is soft-denied — the
run continues, exits `0`, and writes a notice to stderr. This plugin does not rely on that, but
it has not been shown false either, and an earlier draft of these notes said it had been. The
one captured run (`permission-denied.ndjson`) ran under `permission_mode: request-review` and
failed with `user denied permission to run command` — an approval that was *requested and
refused*, which is a different state from one that cannot be obtained. That run does show the
hard-denial path ends the run outright with `status: ERROR` and an empty response; it says
nothing about soft-deny, and NDJSON carries no exit code, so the `exits 0` half was never tested
at all.

Either way `--dangerously-skip-permissions` stays unconditional: soft-denied means the work
silently does not happen, which is no better than denied.
