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
- **`/agy:cancel [job-id]`** — terminate a running job and its child processes (`taskkill /T /F`). A job whose processes are already gone reads as `orphaned`, and nothing is killed.
- **`/agy:resume [job-id|conversation-uuid] [follow-up]`** — continue the latest agy conversation for this repo, or a named one.
- **`/agy:setup`** — health-check the CLI: resolved binary, version, live model list. Also a writer of the model cache and the recorded `agy --version`, alongside `/agy:delegate`'s own weekly, cache-miss, and rejected-model refreshes.
- **`/agy:update`** — run `agy update` and print the changelog entries newer than the old version, for Claude to check against the plugin's workarounds.
- **`/agy:papercut`** — record one friction point by hand, for `/agy:kaizen` to read later.
- **`/agy:kaizen`** — read the friction log, cluster what keeps recurring, and agree on fixes.

### `/agy:delegate`

```bash
/agy:delegate "Add retry-on-429 to src/api/client.ts. Verify with: pnpm test api"
/agy:delegate "Replace every getUser( call with fetchUser( across src/. Verify with: pnpm typecheck"
/agy:delegate --model gemini-3.1-pro --effort high --timeout 1800 "the hard one"
```

The plugin automatically selects the newest `flash` model from the cached `agy models` list at the chosen `--effort` (`medium` by default). A long brief goes in a file: Claude writes it to `~/.cad/briefs/` and passes `--prompt-file`.

| Flag | Effect |
| --- | --- |
| `--prompt-file <path>` | Read the brief from a file instead of the command line. Not combined with an inline task. |
| `--model <id>` | A model family (`gemini-3.1-pro`) or a full id (`gemini-3.8-flash-high`) from `agy models`. Omit it and the newest flash at the chosen `--effort` is used. |
| `--effort <level>` | Sent with a family. Dropped, with a note at dispatch, when the id already encodes effort or the model takes no levels. A level the family lacks is refused by agy, which names the ones it has. |
| `--timeout <sec>` | Overrides print-timeout and the outer watchdog. Default 3600 (60m); watchdog is that plus 60s. |
| `--sandbox` | Restricts terminal commands only. Not a read-only mode. |
| `--conversation <uuid>` | Resume a specific conversation. |
| `--continue` | Resume agy's most recent conversation. Machine-wide, so it may belong to another repository. The plugin never falls back to it. |

Job names look like `add-retry-to-fetchuser-a7f3` and resolve by full name, unique prefix, or the 4-char suffix alone.

### `/agy:result`

Prints agy's report. `--list` shows the last 10 tracked jobs (`--all` for every one), including running ones — so it doubles as the way to recover a job id.

## What the output looks like

On a clean run, the output is agy's report alone. Status tables, file lists, durations, and token counts are omitted because repository state is directly inspectable via `git status` and `git diff`.

The warnings below fire on runs agy reports as finished:

| Line | Means |
| --- | --- |
| `⚠ agy status: ERROR` | agy's own verdict. Fires routinely on runs whose files landed correctly. |
| `⚠ exit 1` | The process exit code. Independent of the above — they disagree in both directions. |
| `⚠ agy wrote to stderr:` | The last 20 lines agy wrote to stderr, on any run. agy is silent there when nothing went wrong, so this carries startup failures, its timeout notice and network errors. |
| `⚠ N tool calls failed during the run` | Tools that failed while the run continued, such as a failed verification step under a `SUCCESS` status. Deduped and capped at three. |
| `⚠ agy compacted its context N times` | agy summarised the conversation mid-run. Work after a compaction is where it most often drifts from the brief. |
| `⚠ agy skipped N actions it was not allowed to take` | Permission denials. Should never fire, since the plugin bypasses permissions. |
| `⚠ <error text>` | The error agy reported, first line first. A long tail is truncated with a count; on an unknown model, the valid ids are listed instead. |
| `⚠ watchdog killed the run` | print-timeout plus 60s grace elapsed. |
| `⚠ agy hit its print timeout after 1h0m0s` | agy stopped itself at its own limit and returned partial output, still reporting `SUCCESS`. |
| `⚠ this run can be resumed where it stopped` | The run ended before agy finished and kept its conversation. |

`delegate.mjs` exits 1 when the run did not finish. That is a fact about the run, not a verdict on the work.

`plugins/agy/skills/output-contract/contract.md` documents this table for the orchestrator, included in `/agy:delegate` and `/agy:result`. `WARNING_IDS` in `scripts/lib/render.mjs` mirrors this table, verified by `tests/contract.test.mjs`.

## The friction log

Every run ending in an actionable `⚠` warning appends a row to
`~/.cad/papercuts.jsonl` (or `CAD_HOME`). `agy-status`, `exit`, `compaction`,
`denied` and `resume` are excluded: they describe the run rather than friction, and most
fire on runs that worked.

One additional source is recorded manually via `/agy:papercut`: `narrated`
quotes agy's report when blocked.

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
- **The brief is written to a sidecar file.** Stored at `~/.cad/jobs/<repo-hash>/<job>.prompt.md` — outside the directory passed to `--add-dir`, which agy reads anyway — then dispatched via `--print=Read the file at <abs> in full and carry out that task exactly.` Attaching the brief directly to `--print=` stops a bare `-p` swallowing the next flag.
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
