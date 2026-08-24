# Changelog

## 0.1.0 — first cut

Delegate coding tasks from Claude Code to the Antigravity CLI (`agy` 1.1.19). Sibling of
[claude-cursor-delegate](https://github.com/ahmadghoniem/claude-cursor-delegate) and
[claude-grok-delegate](https://github.com/ahmadghoniem/claude-grok-delegate); the CLI surface
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

Written against six captured runs of agy 1.1.19, not against published docs (several of which
contradict the binary). In particular: `--add-dir` is mandatory or agy reuses the
persistent default CLI project rooted at `~/.gemini/antigravity-cli/scratch`, writes there, and
still reports `status: SUCCESS` (`--project` binds the cwd in neither of its forms); `--print=<brief>` must be attached and last; the first
shell command hard-kills the run unless permissions are skipped; `--model` slugs that encode
effort cannot be combined with `--effort`; `status` and the process exit code disagree in both
directions.
