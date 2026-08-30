# claude-agy-delegate

Delegate coding tasks, code sweeps, and research passes from Claude Code to the Antigravity CLI (`agy`), then review the diff and land it yourself.

Claude plans and reviews; agy does the typing in its own session. The plugin never commits — that stays with you.

agy is the cheap, fast, high-volume worker in that split: code sweeps (find every call site of X, change it to Y), mini refactors, bulk reading across dozens of files, research, and scoped implementation. The tokens land in agy's context instead of yours.

Third in the series after [claude-cursor-delegate](https://github.com/ahmadghoniem/claude-cursor-delegate) (`cursor-agent`) and [claude-grok-delegate](https://github.com/ahmadghoniem/claude-grok-delegate) (`grok`). The three are independent: install any combination.

## Install

```bash
claude plugin marketplace add ahmadghoniem/claude-agy-delegate
claude plugin install agy@claude-agy-delegate
```

**Windows only.** Requires the Antigravity CLI on `PATH` (or at `%LOCALAPPDATA%\agy\bin\agy.exe`), Node 18.18+.

If a Claude Code session was already open when you installed agy, its `PATH` will not have picked up the installer's change — the plugin checks `%LOCALAPPDATA%\agy\bin\agy.exe` directly for exactly that reason, and `AGY_BIN` overrides both.

## Commands

- **`/agy:delegate <task>`** — hand a task to agy. Claude runs it under a backgrounded Bash call, so you keep chatting while agy works and the harness announces the result — no polling.
- **`/agy:result [job-id]`** — print a finished job's record, or `--list` the tracked jobs.
- **`/agy:cancel [job-id]`** — terminate a running job and everything it spawned (`taskkill /T /F`, killing the whole tree). Also reaps a record left stuck at `running` because its parent process died.
- **`/agy:resume [job-id|conversation-uuid] [follow-up]`** — continue the latest agy conversation for this repo, or a named one.
- **`/agy:setup`** — health-check the CLI: resolved binary, version, live model list.

Plus an **`agy-runner`** agent that shapes a task into a self-contained brief and dispatches it.

### `/agy:delegate`

```bash
/agy:delegate "Add retry-on-429 to src/api/client.ts. Verify with: pnpm test api"
/agy:delegate "Replace every getUser( call with fetchUser( across src/. Verify with: pnpm typecheck"
/agy:delegate --model gemini-3.7-pro-high --timeout 1800 "the hard one"
```

**No model question.** The plugin picks the newest `flash` id from the live `agy models` list, at whatever `--effort` Claude chose for the task (`medium` by default). Claude only asks when your own message shows you want a say — you name a model, ask what is available, or ask for something cheaper/faster/stronger.

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

On a clean run: agy's report, and nothing else. No status table, no file list, no duration, no token or cost figures. `git status` and `git diff` are one call away and are the actual ground truth; a formatted summary of them is just something else to read.

What does get surfaced is the set of ways a run can be wrong while agy still calls it done. Each is its own warning line, and any can fire alone:

| Line | Means |
| --- | --- |
| `⚠ agy status: ERROR` | agy's own verdict. Fires routinely on runs whose files landed correctly. |
| `⚠ exit 1` | The process exit code. Independent of the above — they disagree in both directions. |
| `⚠ agy produced no result. Its stderr:` | agy never got started — not authenticated, unknown `--model`, rejected flag, spawn failure. Only fires when there is no write-up *and* no status, because stderr is then the only explanation there is. The tail tells you which fix applies. |
| `⚠ N tool calls failed during the run` | Tools that failed while the run continued. Reported, never judged — the case that matters is a failed verification step under a `SUCCESS` status. Deduped and capped at three. |
| `⚠ <error text>` | The error agy reported, first line first. A long tail is truncated with a count; the full text is in the job log. |
| `⚠ watchdog killed the run` | print-timeout plus 60s grace elapsed. |
| `⚠ agy reported file changes but the working tree is unchanged` | The writes went to `~/.gemini/antigravity-cli/scratch`. The work is not in your repo. |

The same table, in the form the orchestrator actually reads, is `plugins/agy/skills/output-contract/contract.md` — preloaded into `agy-runner` and pulled into `/agy:delegate` and `/agy:result` at load time. `WARNING_IDS` in `scripts/lib/render.mjs` is its machine-readable twin, and `tests/contract.test.mjs` fails if the two drift.

## Design notes

- **`--add-dir <absolute repo path>` is always passed on a fresh dispatch, and it is the only workspace flag sent.** Without it agy does not use the spawn cwd at all: it reuses the persistent default CLI project, whose root is `~/.gemini/antigravity-cli/scratch`, writes there, leaves the repo untouched, and still reports `status: SUCCESS`. `--new-project` binds the cwd too, but it does the same job while creating a throwaway project on every dispatch. `--project` binds nothing — neither an absolute path nor a project name stops the fallback to scratch.
- **The brief is always a sidecar file.** Written to `<job>.prompt.md` (outside the workspace is fine; agy can still read it), then dispatched with `--print=Read the file at <abs> in full and carry out that task exactly.` Last on the command line, attached to the flag, so a bare `-p` cannot swallow the next flag.
- **Permission bypass is always on.** The first shell command otherwise hard-kills the run, which makes an opt-out a foot-gun rather than a safety feature. There is no `--safe` and no plan mode: this plugin dispatches implementors and researchers, and planning is the orchestrator's job.
- **No hardcoded model list, and no model prompt.** `agy models` is parsed at runtime (TSV of id then label); the default is the newest flash version in it, at the requested effort. agy encodes effort in the id (`gemini-3.7-flash-low`), so choosing the model and choosing the effort are one act — which is why `--effort` steers the pick instead of being a separate flag. The account default is the display label in `~/.gemini/antigravity-cli/settings.json`, used only as a fallback when nothing in the list is flash.
- **Non-blocking without detaching.** The job runs in the foreground of its own process under a backgrounded Bash call, so the harness reports the exit. There is no detached-worker mode: it would sever that notification and leave polling as the only option.
- **agy.exe is a native Go binary.** Spawned directly, no shell, stdin ignored.
- **The plugin never commits.** You read the diff.

## Environment

| Variable | Effect |
| --- | --- |
| `AGY_BIN` | Full path to the agy binary; skips discovery. |
| `CAD_HOME` | Job registry location. Default `%USERPROFILE%\.cad`. |

## Licence

MIT.
