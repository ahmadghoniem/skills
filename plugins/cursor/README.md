# cursor

Delegate coding tasks from Claude Code to the [Cursor CLI](https://cursor.com/docs/cli/overview) (`cursor-agent`), then review the diff and land it yourself.

Claude writes the brief and reviews the result; Cursor does the editing in its own chat. The plugin never commits.

Sibling of [grok](../grok/README.md), which does the same for the Grok Build CLI, and [agy](../agy/README.md), which does it for the Antigravity CLI. This plugin follows their conventions. All three are independent: install any combination.

## Install

```bash
claude plugin marketplace add ahmadghoniem/skills
claude plugin install cursor@ahmadghoniem
```

Windows only. Requires the Cursor CLI (checked on `2026.10.22-27dcf5f`) at `%LOCALAPPDATA%\cursor-agent` or as `cursor-agent` on `PATH`, signed in with `cursor-agent login`, and Node 18.18+.

The plugin looks for the CLI in this order: `CURSOR_AGENT_BIN`, then `%LOCALAPPDATA%\cursor-agent\cursor-agent.cmd`, then `cursor-agent` on `PATH`. The installer's folder is checked directly because a Claude Code session opened before the install does not see its `PATH` change. The bare name `agent` is never used: Grok Build installs an `agent.exe` too, and whichever comes first on `PATH` wins.

## Commands

- **`/cursor:delegate <task>`** hands a task to Cursor. Claude writes a brief to `~/.ccd/briefs/<name>.md` and runs it under a backgrounded Bash call, so you keep working while Cursor runs and the harness reports when it ends.
- **`/cursor:result [job]`** prints a finished job's write-up, a progress line for a running one, or with `--list` the last 10 jobs (`--all` for every one), running and orphaned jobs included.
- **`/cursor:resume [job|chat-id] [follow-up]`** continues a job's Cursor chat. With no id it picks the newest job in this repository that has a chat id.
- **`/cursor:cancel [job]`** kills a running job and every process it started (`taskkill /T /F`). A job whose processes are already gone is reported as orphaned.
- **`/cursor:setup`** checks the binary, version, login state, plan, account default model and available models.
- **`/cursor:update`** runs `cursor-agent update`, prints the old and new versions and the changelog link, and reviews the open papercuts against the new version.
- **`/cursor:papercut`** records what Cursor said blocked it (`--text`), or closes papercuts once fixed (`--resolve <key|id> --note`).

Jobs are named from the task's first words plus a 4-character suffix, such as `add-retry-to-fetchuser-a7f3`. Every command that takes a job accepts the full name, a unique prefix, or the suffix alone.

### `/cursor:delegate` flags

```bash
/cursor:delegate "Add retry-on-429 to src/api/client.ts. Verify with: pnpm test api"
/cursor:delegate --prompt-file C:/Users/me/.ccd/briefs/rename-client.md
```

| Flag | Effect |
| --- | --- |
| `--prompt-file <path>` | Read the brief from a file. |
| `--model <id>` | The model. Defaults to the account default (Composer 2.5 on Plus). A model the plan does not allow is refused and the refusal is shown as `⚠ error:`. |
| `--timeout <sec>` | Kill the run after this many seconds. Off by default. cursor-agent has no overall or idle limit of its own; see `docs/unverified.md`. |
| `--session <chat-id>` | Continue that Cursor chat. `/cursor:resume` sets it for you. |

## What the output looks like

A clean run prints Cursor's write-up and nothing else. Changed files, durations and token counts are left out because `git status` and `git diff` show the real state.

The plugin adds a `⚠` line for each way a run can be wrong while Cursor still calls it done. Any of them can fire alone:

| Line | Means |
| --- | --- |
| `⚠ stop reason: …` | The `subtype` of Cursor's closing `result` event when it is not `success`; `error` when that event sets `is_error`; `incomplete` when no `result` event arrived. |
| `⚠ exit N` | The process exit code. It can disagree with the stop reason in either direction. |
| `⚠ error: …` | Why the run stopped, in Cursor's words: an error `result` event, or the end of stderr on a failing exit. A model the plan does not allow shows up here as `ActionRequiredError: Named models unavailable …`. |
| `⚠ run was killed before finishing` | The `--timeout` fired; the write-up may be partial. |
| `⚠ N commands exited non-zero` | Shell commands that failed, with up to ten lines of output each. Reported, never fatal: a `grep` with no match or a deliberately failing test lands here too. |
| `⚠ Cursor reported file changes but the working tree is unchanged` | The write-up claims edits and `git status` before and after the run shows none. |
| `⚠ this run can be resumed where it stopped: /cursor:resume <id>` | The run ended early after the model had started, so its chat survives. |

At most once a day, a line after the output says a newer Cursor CLI version is available. The source is `cursor-agent about --format json`, which gives the latest version but no release date or list, so the line names the version only. `CCD_RELEASE_CHECK=off` turns it off.

`contract.md` holds the same table in the form Claude reads; `/cursor:delegate`, `/cursor:resume` and `/cursor:result` include it at load time. `WARNING_IDS` in `scripts/lib/render.mjs` lists the same ids, and `tests/contract.test.mjs` fails if the two differ.

The `wander`, `error-detail`, `killed` and `failed-commands` warnings are also appended to `~/.ccd/papercuts.jsonl`, and `/cursor:update` groups them for review.

## How Cursor is run

Every dispatch runs `cursor-agent -p --output-format stream-json --force --disable-auto-update`, plus:

- **`--force`**: a headless run cannot answer an approval prompt, so without it Cursor cannot run commands or write files. The plugin never commits and you read the diff instead.
- **`--disable-auto-update`** (hidden in `--help`): the CLI changes only when you run `/cursor:update`.
- **`--new-session-id <uuid>`** on a new run (hidden in `--help`), or **`--resume <chat-id>`** on a resume: the chat id is fixed before the run starts, so a killed run can still be resumed.
- **`--`** before the brief, so a brief that starts with `-` is not read as a flag. A brief over 24,000 characters is saved next to the job log and Cursor is told to read it from there, because Windows caps a command line at 32,767 characters.

Not passed: `--trust` (a headless run does not ask for workspace trust), `--approve-mcps`, `--stream-partial-output` (without it each `assistant` event is one whole message), and `--continue` or a bare `--resume`, which pick the newest chat in the directory, which may belong to someone else.

### What Cursor loads on its own

Cursor has no switch for the context it loads. It reads Claude-format files as well as its own, and in the CLI that cannot be turned off: `getThirdPartyExtensibilityEnabled` always returns true, and nothing in the CLI reads Cursor's `thirdPartyExtensibility` setting. `--exclude-workspace-context` is refused on the Free and Plus plans (`Workspace context exclusion is not allowed for this user, team, or selected model`).

The plugin runs Cursor with its stock settings, so a run loads, from the repo and every parent directory up to the drive root:

- `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md` and `.cursor/rules/`
- skills under `.cursor/`, `.claude/`, `.agents/`, `.codex/` and `.grok/`
- hooks and permissions from `.claude/settings.json`

From your home folder it loads the same skill folders, the MCP servers in `~/.cursor/mcp.json`, the hooks and permissions in `~/.claude/settings.json`, and the commands in `~/.claude/commands`. It does not load `~/.claude/CLAUDE.md`, `~/.claude/rules/` or Claude Code plugins. A "Reply OK" run took 8,389 input tokens this way; with the home-folder files hidden it took 4,769.

## Other notes

- `windowsHide: true` is set on every spawn. A dispatch from a backgrounded Bash call has no console, so without it Windows opens a terminal window for `cursor-agent` that stays for the whole job.
- On Windows the plugin spawns the `node.exe` and `index.js` behind `cursor-agent.cmd` directly, because Node cannot spawn a `.cmd` without a shell, and a shell would expand `%VAR%` in the brief.
- A cursor-agent process still running 10 seconds after its `result` event is stopped; the run still counts as finished.
- `cursor-agent --version` checks the binary on every dispatch because it is local and instant.

## Environment

| Variable | Effect |
| --- | --- |
| `CURSOR_AGENT_BIN` | Full path to `cursor-agent`; skips discovery. |
| `CCD_HOME` | Where jobs, papercuts and the release cache live. Default `%USERPROFILE%\.ccd`. |
| `CCD_RELEASE_CHECK` | `off` skips the daily `cursor-agent about` check and the update line. |

## Licence

MIT. A fork of cursor-plugin-cc by Tomas Grasl; see `NOTICE`.
