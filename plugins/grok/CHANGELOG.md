# Changelog

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
