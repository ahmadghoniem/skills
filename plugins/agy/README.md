# agy

Delegate coding tasks, code sweeps, and research passes from Claude Code to the Antigravity CLI (`agy`), then review the diff and land it yourself.

Claude plans and reviews; agy writes code in its own session. The plugin never commits; review and commit changes directly.

agy handles high-volume tasks: code sweeps, refactors, bulk file reading, research, and scoped implementations. Tokens land in agy's context instead of yours.

Third in the series after [cursor](../cursor/README.md) (`cursor-agent`) and [grok](../grok/README.md) (`grok`). Each plugin is independent.

## Install

```bash
claude plugin marketplace add ahmadghoniem/skills
claude plugin install agy@ahmadghoniem
```

**Windows only.** Requires the Antigravity CLI on `PATH` (or at `%LOCALAPPDATA%\agy\bin\agy.exe`), Node 18.18+.

If Claude Code was opened before installing agy, `PATH` may lack the binary; the plugin falls back to `%LOCALAPPDATA%\agy\bin\agy.exe`, and `AGY_BIN` overrides both.

## Commands

- **`/agy:delegate <task>`** — run a task via agy. Claude runs it under a backgrounded Bash call and announces completion without polling.
- **`/agy:result [job-id]`** — print a finished job's record, or `--list` the tracked jobs.
- **`/agy:cancel [job-id]`** — terminate a running job and its child processes (`taskkill /T /F`). Also reaps job records left at `running` if the parent process died.
- **`/agy:resume [job-id|conversation-uuid] [follow-up]`** — continue the latest agy conversation for this repo, or a named one.
- **`/agy:setup`** — health-check the CLI: resolved binary, version, live model list. Also the only writer of the model cache and the recorded `agy --version`.
- **`/agy:papercut`** — record one friction point by hand, for `/agy:kaizen` to read later.
- **`/agy:kaizen`** — read the friction log, cluster what keeps recurring, and agree on fixes.

Plus an **`agy-runner`** agent that shapes a task into a self-contained brief and dispatches it.

### `/agy:delegate`

```bash
/agy:delegate "Add retry-on-429 to src/api/client.ts. Verify with: pnpm test api"
/agy:delegate "Replace every getUser( call with fetchUser( across src/. Verify with: pnpm typecheck"
/agy:delegate --model gemini-3.7-pro-high --timeout 1800 "the hard one"
```

The plugin automatically selects the newest `flash` model from `agy models` at the chosen `--effort` (`medium` by default). Claude prompts for a model only when requested in the prompt.

| Flag | Effect |
| --- | --- |
| `--model <id>` | Pin a model from the live `agy models` list. Omit it and the newest flash at the chosen `--effort` is used. |
| `--effort <level>` | Sent only when the model id does not already end in `-low` / `-medium` / `-high`. |
| `--timeout <sec>` | Overrides print-timeout and the outer watchdog. Default 900 (15m); watchdog is that plus 60s. |
| `--sandbox` | Restricts terminal commands only. Not a read-only mode. |
| `--no-git-check` | Allow dispatching outside a git repository. |
| `--conversation <uuid>` | Resume a specific conversation. |
| `--continue` | Resume the most recent conversation for this directory. |

Job names look like `add-retry-to-fetchuser-a7f3` and resolve by full name, unique prefix, or the 4-char suffix alone.

### `/agy:result`

Prints agy's report. `--list` shows the last 10 tracked jobs (`--all` for every one), including running ones — so it doubles as the way to recover a job id.

## What the output looks like

On a clean run, the output is agy's report alone. Status tables, file lists, durations, and token counts are omitted because repository state is directly inspectable via `git status` and `git diff`.

The warnings below fire on runs agy reports as finished. Each is its own line, and any can fire alone:

| Line | Means |
| --- | --- |
| `⚠ agy status: ERROR` | agy's own verdict. Fires routinely on runs whose files landed correctly. |
| `⚠ exit 1` | The process exit code. Independent of the above — they disagree in both directions. |
| `⚠ agy produced no result. Its stderr:` | agy never started (unauthenticated, unknown `--model`, rejected flag, spawn failure). Fires only when there is no write-up and no status. The tail indicates the cause. |
| `⚠ N tool calls failed during the run` | Tools that failed while the run continued, such as a failed verification step under a `SUCCESS` status. Deduped and capped at three. |
| `⚠ <error text>` | The error agy reported, first line first. A long tail is truncated with a count; the full text is in the job log. |
| `⚠ watchdog killed the run` | print-timeout plus 60s grace elapsed. |
| `⚠ agy reported file changes but the working tree is unchanged` | The writes went to `~/.gemini/antigravity-cli/scratch`. The work is not in your repo. |

`plugins/agy/skills/output-contract/contract.md` documents this table for the orchestrator, preloaded into `agy-runner` and included in `/agy:delegate` and `/agy:result`. `WARNING_IDS` in `scripts/lib/render.mjs` mirrors this table, verified by `tests/contract.test.mjs`.

## The friction log

Every run ending in an actionable `⚠` warning appends a row to
`~/.cad/papercuts.jsonl` (or `CAD_HOME`). `agy-status`, `exit`, and `resume`
are excluded because they fire on successful runs.

Two additional sources are recorded manually via `/agy:papercut`: `narrated`
quotes agy's report when blocked, and `orchestrator` records brief failures
(expected outcome, actual result, and the failing clause).

All entries record what occurred without diagnosing why. Analysis is deferred
to `/agy:kaizen` across aggregated clusters in a separate session.

Rows are append-only and never edited or deduplicated. Resolving via
`/agy:kaizen --resolve <id> --note "…"` appends a resolution, allowing
subsequent recurrences to be detected.

Each row copies necessary evidence rather than linking to the job record,
because `pruneOlderThanDays` deletes job directory files older than 30 days
(including raw event streams) on every dispatch.

## Design notes

- **`--add-dir <absolute repo path>` is always passed on fresh dispatch and is the only workspace flag sent.** Without it, agy ignores the working directory and defaults to `~/.gemini/antigravity-cli/scratch` while reporting `status: SUCCESS`. `--new-project` also binds the working directory but creates a throwaway project on every run. `--project` binds neither absolute paths nor project names, falling back to scratch.
- **The brief is written to a sidecar file.** Stored at `~/.cad/<repo-hash>/<job>.prompt.md` — outside the directory passed to `--add-dir`, which agy reads anyway — then dispatched via `--print=Read the file at <abs> in full and carry out that task exactly.` Attaching the brief directly to `--print=` stops a bare `-p` swallowing the next flag.
- **Permission bypass is always on.** Without it the first shell command kills the run outright, so an opt-out would break runs rather than make them safer. Planning remains the orchestrator's responsibility.
- **Dynamic model discovery without hardcoded lists.** `agy models` is parsed at runtime. The default selects the newest flash model matching the requested effort. Because agy encodes effort directly in the model id (e.g. `gemini-3.7-flash-low`), `--effort` selects the appropriate model id. The display label in `~/.gemini/antigravity-cli/settings.json` serves as fallback when no flash model is listed.
- **Non-blocking execution without detached workers.** The job runs in the foreground of its process under a backgrounded Bash call, allowing the harness to report exit events directly without polling.
- **agy.exe is a native Go binary.** Spawned directly, no shell, stdin ignored.
- **The plugin never commits.** You read the diff.

## Environment

| Variable | Effect |
| --- | --- |
| `AGY_BIN` | Full path to the agy binary; skips discovery. |
| `CAD_HOME` | Job registry location. Default `%USERPROFILE%\.cad`. |

## Licence

MIT.
