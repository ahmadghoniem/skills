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

**Windows** only. Requires the Antigravity CLI on `PATH` (or at `%LOCALAPPDATA%\agy\bin\agy.exe`), Node 18.18+.

If Claude Code was opened before installing agy, `PATH` may lack the binary; the plugin falls back to `%LOCALAPPDATA%\agy\bin\agy.exe`, and `AGY_BIN` overrides both.

## Commands

- **`/agy:delegate <task>`** — run a task via agy. Claude runs it under a backgrounded Bash call and announces completion without polling.
- **`/agy:result [job-id]`** — print a finished job's record, or `--list` the tracked jobs.
- **`/agy:cancel [job-id]`** — terminate a running job and its child processes (`taskkill /T /F`). A job whose processes are already gone reads as `orphaned`, and nothing is killed.
- **`/agy:resume [job-id|conversation-uuid] [follow-up]`** — continue the latest agy conversation for this repo, or a named one.
- **`/agy:setup`** — health-check the CLI: resolved binary, version, a model cache refresh, and the bash tool's entry in agy's MCP config. Also a writer of the model cache and the recorded `agy --version`, alongside `/agy:delegate`'s own weekly, cache-miss, and rejected-model refreshes.
- **`/agy:update`** — run `agy update`, print the changelog entries newer than the old version and the open papercuts, for Claude to review against the plugin. `/agy:delegate` checks GitHub for a new agy release once a day, alongside the run, and ends its output with a notice when one is out.
- **`/agy:papercut`** — record one friction point by hand, or close one with `--resolve`.

### The agy agent

Fresh dispatches run agy with `bash-delegate` from `agy-agents/`. It reaches agy inside a
native agy plugin named `agy`, together with its bash tool: `delegate.mjs` and
`/agy:setup` build the plugin from this checkout and run `agy plugin install` whenever the
installed copy in `~/.gemini/config/plugins/agy/` is missing or differs. agy copies a
plugin on install, so a change to the agent takes effect at the next dispatch. Once the
plugin is in, they remove what earlier versions wrote into agy's global config: the agent
copies in `~/.gemini/config/agents/` and the `agy` server in `mcp_config.json`.

Its own tools are `read_file`, `search_web`, `read_url_content`, `manage_task`, the
subagent tools (`invoke_subagent`, `define_subagent`, `manage_subagents`) and `run_workflow`;
everything else goes through the bash tools below (`inheritMcp`). Files are created and edited with
`apply-patch`, a bash function that runs `mcp/apply-patch.mjs`, a copy of the repo's
`tools/apply-patch`.
`excludeDefaultComponents` drops agy's default prompt components. agy still loads
`AGENTS.md` and `GEMINI.md` itself, from the workspace and from the directories of the
files it reads, but never `CLAUDE.md`. The plugin does not point agy at `CLAUDE.md`
either: Claude puts what the task needs from it in the brief.

A resumed conversation keeps the agent it started with.

### The bash tools

`mcp/bash.mjs` gives agy a `bash` tool (Git Bash) that runs a command in the foreground
until it exits or its `timeout_ms` passes (default 2 min, max 20 min). agy's own
`run_command` runs PowerShell and moves anything past 10 s to the background.

A command still running at its timeout is not killed: it becomes a job, and the result
holds its output so far and the job number. `bash_bg` with that `job` takes it over.
`bash_bg` also runs a new command (a dev server, a watcher, a long build) as an agy
background task: it returns at once, and agy sends the output to the model when the
command exits. In a headless run agy waits for running background tasks before it exits,
then delivers their output. The agent stops anything that does not exit on its own with
`manage_task kill` before its report.

agy cuts an MCP tool's result over about 10 KB (bytes, not characters) to roughly its first
and last 4,900 bytes, and saves the full text to a file it names. So the tool cuts an output
over 9,000 bytes (UTF-8, so about 3,000 characters of CJK text) itself, keeping whole lines
from both ends,
and puts a note where the middle was: which lines are missing, how many `rg` matches each
file had there (or how many paths each directory had, for a listing), and the path of the
full output, kept for a week (for good when `AGY_BASH_KEEP_DIR` names a directory to
save it in). When the command only printed a file (`cat`, `head`,
`sed -n`), the note gives that file's missing line range for `read_file` instead. agy's own
`read_file` is not cut this way, so it stays, and the agents are told to read with it.

Output split by `== <label>` lines is cut section by section: a section that fits an even
share of the 9,000 bytes is kept whole, and the long ones split the rest. The agent
is told to run independent searches in one call this way: a model often spreads lookups
over several turns, and every separate bash call waits on its own safety check. In a
paired benchmark on Hydrogen (7 tasks rebuilt from real jobs, 11 pairs over 2 rounds,
2026-11-21) that rule cut turns by 25%, cached tokens by 30% and safety checks by 32%,
lower in all 11 pairs, and job time by 23%, lower in 10 of 11. Passes were 4 against 4:
one task passed only without the rule and one only with it.

The tool's `rg` runs with `--max-columns=300 --max-columns-preview`, so a minified line
shows as a preview. These are added to the user's own `RIPGREP_CONFIG_PATH` file when it
does not set them already.

The plugin registers it as its `shell` server, pointing at this checkout's `mcp/bash.mjs`,
so an edit to the bash tool is live without a reinstall. agy lists the tools to the model
directly as `mcp_agy_shell_bash` and `mcp_agy_shell_bash_bg` (`eager`), so no
`call_mcp_tool` lookup is needed, and runs every `bash_bg` call as a background task
(`background: "always"`). An installed plugin loads in every agy session, so the server
also reaches resumed conversations and interactive agy sessions.

Every call to the bash tool waits about 1.3 s while agy sends it to a Flash-Lite safety
model, which runs before the command and can block it. agy skips that check only for its
own read-only built-ins (`read_file`, `search_web`, `manage_task` list/status, and
`run_command` for a short list of read-only commands such as `git status`). `edit_file`,
any other `run_command` and every MCP tool are checked, and the plugin cannot turn it off.

What was measured (agy 1.5.8 to 1.5.10, Gemini 4), so it need not be measured again:

- **Cost.** 1,737 checks in 81 job logs from 2026-11-14 to 11-21: median 1.31 s, mean
  1.40 s, 2,440 s of 43,508 s of job time (5.6%). 6 went on to a larger model
  (`severe_internal_risks_agy`), median 5.6 s. Each check is a
  `Monitor sir_flash_lite FINISHED ... duration=` line in the job's `.agy.log` under
  `~/.cad/jobs`; a skipped call logs `reason="allowed_tool"` instead.
- **One check per tool call, however much the call runs.** A 12-block patch followed by
  `npm test` in one bash call costs one check, the same as `ls`. On 2026-11-14 the same
  task (5 files changed, all 197 tests passing in both runs) took the stock agent 14
  `edit_file` and 8 `run_command` calls: 21 checks, 22.2 s. `bash-delegate` took 4 bash
  calls: 4 checks, 4.9 s. Its 8 `read_file` calls were not checked.
- **No switch.** agy 1.5.10's `settings.json`, `config.json`, policies and command-line
  flags have no setting for it; the monitor configuration is built into `agy.exe`.
  `--dangerously-skip-permissions` skips only the approval prompts, and `--sandbox` only
  restricts agy's own terminal commands.
- **The 10 KB cut.** agy's note reads `<truncated N of M bytes from the middle of the
  output>` and keeps about 9,880 bytes. The smallest result it cut was 10,375 bytes and the
  largest it left whole about 10,190, so the limit is near 10,240 bytes. On 2026-11-21 a
  command printed 8,417 characters of CJK text (23,951 bytes), under the old
  budget of 9,000 counted in characters, and agy cut 14,073 bytes from its middle.

### `/agy:delegate`

```bash
/agy:delegate "Add retry-on-429 to src/api/client.ts. Verify with: pnpm test api"
/agy:delegate "Replace every getUser( call with fetchUser( across src/. Verify with: pnpm typecheck"
/agy:delegate --model gemini-4-hydrogen-high --timeout 1800 "the hard one"
```

The plugin uses `gemini-4-hydrogen-medium` unless `--model` names another id from `agy models`. A long brief goes in a file: Claude writes it to `~/.cad/briefs/` and passes `--prompt-file`.

| Flag | Effect |
| --- | --- |
| `--prompt-file <path>` | Read the brief from a file instead of the command line. Not combined with an inline task. |
| `--model <id>` | A full id from `agy models`, such as `gemini-4-hydrogen-high`; the id carries the effort level. agy checks it, and an unknown id lists the valid ones. |
| `--timeout <sec>` | Sets agy's print-timeout. No limit by default; `/agy:cancel` stops a run. |
| `--sandbox` | Restricts agy's own terminal commands only. |
| `--conversation <uuid>` | Resume a specific conversation. |
| `--continue` | Resume agy's most recent conversation in this workspace. The plugin never falls back to it. |

Job names look like `add-retry-to-fetchuser-a7f3` and resolve by full name, unique prefix, or the 4-char suffix alone.

### `/agy:result`

Prints agy's report. `--list` shows the last 10 tracked jobs (`--all` for every one), including running ones — so it doubles as the way to recover a job id.

## What the output looks like

On a clean run, the output is agy's report alone. Status tables, file lists, durations, and token counts are omitted because repository state is directly inspectable via `git status` and `git diff`.

The warnings below fire on runs agy reports as finished:

| Line | Means |
| --- | --- |
| `⚠ agy status: ERROR` | agy's own verdict, not a pass/fail: work done before the error stays in the tree, so read the diff. |
| `⚠ exit 1` | The process exit code. Independent of the above — they disagree in both directions. `3` means the turn ended on a model or agent API error. |
| `⚠ agy wrote to stderr:` | The last 20 lines agy wrote to stderr, on any run. agy is silent there when nothing went wrong, so this carries startup failures, its timeout notice, network errors and the `AGY_ERROR` line. |
| `⚠ N tool calls failed during the run` | Tools that failed while the run continued, such as a failed verification step under a `SUCCESS` status. Deduped and capped at three. |
| `⚠ agy compacted its context N times` | agy summarised the conversation mid-run. Work after a compaction is where it most often drifts from the brief. |
| `⚠ <error text>` | The error agy reported, first line first. A long tail is truncated with a count; on an unknown model, the valid ids are listed instead. |
| `⚠ agy hit its print timeout after 15m0s` | agy stopped itself at its own limit and returned partial output. Read from the result's `finished_reason` or agy's stderr notice. |
| `⚠ agy ended the turn early: finished_reason interrupted` | agy's own reason for ending the turn early, verbatim: `interrupted` or `error`. |
| `⚠ this run can be resumed where it stopped` | The run ended before agy finished and kept its conversation. |

`delegate.mjs` exits 1 when the run did not finish. That is a fact about the run, not a verdict on the work.

`plugins/agy/contract.md` documents this table for the orchestrator, included in `/agy:delegate`, `/agy:result` and `/agy:resume`. `WARNING_IDS` in `scripts/lib/render.mjs` mirrors this table, verified by `tests/contract.test.mjs`.

## The friction log

Every run ending in an actionable `⚠` warning appends a row to
`~/.cad/papercuts.jsonl` (or `CAD_HOME`). Each row has a `key` naming its group
(the warning id, or `tool-errors:<tool>` with one row per failing tool) and a
`text` holding the failure itself. `agy-status`, `exit`, `compaction`,
`finished-reason` and `resume` are excluded: they describe the run rather than
friction, and most fire on runs that worked.

One additional source is recorded manually via `/agy:papercut`: `narrated`
quotes agy's report when blocked.

All entries record what occurred without diagnosing why. `/agy:update` prints
the open clusters after each agy update, for Claude to review against the
release.

Rows are append-only and never edited or deduplicated. Resolving via
`/agy:papercut --resolve <key> --note "…"` appends a resolution that closes every
cut under that key recorded before it, so a later cut under the same key shows as
a recurrence. `--resolve <id>` closes one cut.

Each row copies necessary evidence rather than linking to the job record, so it
can be judged on its own even if the job directory is cleared by hand.

## Design notes

- **The message goes on stdin.** A fresh job's message is one line saying whether the workspace is a git repository (and, for a single commit or a shallow clone, that there is no history to search), then the brief, sent as one `--input-format stream-json` line; `delegate.mjs` then closes stdin, and agy exits when the turn ends. A resume sends only the follow-up. `--disable-slash-commands` stops a message that starts with `/usage` or similar from running a command. agy keeps the message in its brain transcript. agy cuts a stdin message short without an error (a 324,000-char message kept about 191,000), so a message over 150,000 chars fails the job before agy starts. The longest of 494 recorded jobs was 15,466 chars.
- **Permission bypass is always on.** Without it the first shell command kills the run outright, so an opt-out would break runs rather than make them safer. Planning remains the orchestrator's responsibility.
- **Model.** The default is `gemini-4-hydrogen-medium`. On two replayed design-playground jobs with agy's stock agent (2 runs each, November 2026), it matched 3.8 flash medium's results in about a quarter of the time and a sixth of the input tokens. The plugin passes `--model` to agy as given; agy checks it, and the cached `agy models` list is printed when it rejects one.
- **Non-blocking execution without detached workers.** The job runs in the foreground of its process under a backgrounded Bash call, allowing the harness to report exit events directly without polling.
- **agy.exe is a native Go binary.** Spawned directly, no shell. Each job has its own stdin pipe, so several jobs can run at once.
- **The plugin never commits.** You read the diff.

## Environment

| Variable | Effect |
| --- | --- |
| `AGY_BIN` | Full path to the agy binary; skips discovery. |
| `CAD_HOME` | Job registry location. Default `%USERPROFILE%\.cad`. |

## Licence

MIT.
