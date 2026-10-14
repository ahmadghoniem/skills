# grok

Delegate coding tasks from Claude Code to the [Grok Build CLI](https://docs.x.ai/build/cli) (`grok`), then review the diff and land it yourself.

Claude writes the brief and reviews the result; grok does the editing in its own session. The plugin never commits.

Sibling of [cursor](../cursor/README.md), which does the same for Cursor CLI, and [agy](../agy/README.md), which does it for the Antigravity CLI. This plugin follows agy's conventions. All three are independent: install any combination.

## Install

```bash
claude plugin marketplace add ahmadghoniem/skills
claude plugin install grok@ahmadghoniem
```

Windows only. Requires grok 1.0.52 or later on `PATH` (or at `%USERPROFILE%\.grok\bin\grok.exe`), signed in with `grok login`, and Node 18.18+.

A Claude Code session opened before grok was installed does not see the installer's `PATH` change, so the plugin also checks `%USERPROFILE%\.grok\bin` directly. `GROK_BIN` overrides both.

## Commands

- **`/grok:delegate <task>`** hands a task to grok. Claude writes a brief to `~/.cgd/briefs/<name>.md` and runs it under a backgrounded Bash call, so you keep working while grok runs and the harness reports when it ends.
- **`/grok:result [job]`** prints a finished job's write-up, a progress line for a running one, or with `--list` the last 10 jobs (`--all` for every one), running and orphaned jobs included.
- **`/grok:resume [job|uuid] [follow-up]`** continues a job's grok session. With no id it picks the newest job in this repository that has a session.
- **`/grok:cancel [job]`** kills a running job and every process it started (`taskkill /T /F`). A job whose processes are already gone is reported as orphaned.
- **`/grok:setup`** checks the binary, version, login state and available models.
- **`/grok:update`** runs `grok update`, lists the releases since the old version with their dates, and reviews the open papercuts against the new version.
- **`/grok:papercut`** records what grok said blocked it (`--text`), or closes papercuts once fixed (`--resolve <key|id> --note`).

Jobs are named from the task's first words plus a 4-character suffix, such as `add-retry-to-fetchuser-a7f3`. Every command that takes a job accepts the full name, a unique prefix, or the suffix alone.

### `/grok:delegate` flags

```bash
/grok:delegate "Add retry-on-429 to src/api/client.ts. Verify with: pnpm test api"
/grok:delegate --effort low --prompt-file C:/Users/me/.cgd/briefs/rename-client.md
```

| Flag | Effect |
| --- | --- |
| `--prompt-file <path>` | Read the brief from a file. |
| `--model <id>` | Pin a model. Omitted, grok uses the account default that `grok models` reports. |
| `--effort low\|medium` | Grok's `--reasoning-effort`. Default `medium`. The xAI plan this was built on allows only `low` and `medium`, so anything else is refused. |
| `--timeout <sec>` | Watchdog, default 4800. That is longer than grok's own 3600s idle timeout, so grok fails first and says why. |
| `--session <uuid>` | Continue that grok session. `/grok:resume` sets it for you. |

## What the output looks like

A clean run prints grok's write-up and nothing else. Changed files, durations and token counts are left out because `git status` and `git diff` show the real state.

The plugin adds a `⚠` line for each way a run can be wrong while grok still calls it done. Any of them can fire alone:

| Line | Means |
| --- | --- |
| `⚠ stop reason: …` | grok's own stop reason, when it is not `end_turn`. |
| `⚠ exit N` | The process exit code. It can disagree with the stop reason in either direction. |
| `⚠ error: …` | Why the run stopped, in grok's words: its `error` event, or the end of stderr on a failing exit. |
| `⚠ run was killed before finishing` | The watchdog fired; the write-up may be partial. |
| `⚠ N commands exited non-zero` | Terminal commands that failed, with up to ten lines of output each. Reported, never fatal: a `grep` with no match or a deliberately failing test lands here too. |
| `⚠ grok reported file changes but the working tree is unchanged` | The write-up claims edits and `git status` before and after the run shows none. |
| `⚠ this run can be resumed where it stopped: /grok:resume <id>` | The run ended early and its session survives. |

At most once a day, a line after the output says when a newer grok is out, how old it is, and how many releases came out since the installed one. The release data comes from the npm registry entry for `@xai-official/grok`, because grok publishes no changelog. `CGD_RELEASE_CHECK=off` turns it off.

`contract.md` holds the same table in the form Claude reads; `/grok:delegate`, `/grok:resume` and `/grok:result` include it at load time. `WARNING_IDS` in `scripts/lib/render.mjs` lists the same ids, and `tests/contract.test.mjs` fails if the two differ.

The `wander`, `error-detail`, `killed` and `failed-commands` warnings are also appended to `~/.cgd/papercuts.jsonl`, and `/grok:update` groups them for review.

## How grok is run

Every dispatch passes these flags:

- **`--prompt-file`**: the brief stays out of the process list, is not limited by the argument-length cap, and cannot be read as a flag.
- **`--always-approve`**: a headless run cannot answer an approval prompt and would stall. The plugin never commits and you read the diff instead.
- **`--no-plan` and `--disallowed-tools`**: removes plan mode and the 11 built-in tools a headless run cannot use or does not need (image and video generation, `ask_user_question`, plan mode, `send_feedback`, the scheduler). Read, write, search, shell and web tools stay.
- **`--no-auto-update`**: the binary changes only when you run `/grok:update`.
- **`-s <uuid>`** on a new run, or **`--resume <uuid>`** on a resume: the session id is fixed before the run starts, so a killed run can still be resumed.

`--trust` is never passed, so grok does not load the repo's `AGENTS.md`, `CLAUDE.md`, MCP servers, hooks or skills. Claude puts what the task needs in the brief.

`--sandbox` is never passed: grok accepts an unknown profile name without an error and runs anyway, so it offers no guarantee. `--continue` is never passed either: it picks the newest session in the directory, which may belong to another Claude session or a grok TUI.

Every run sets `GROK_{CLAUDE,CURSOR}_{AGENTS,HOOKS,MCPS,RULES,SKILLS}_ENABLED=false`, so grok does not load the agents, hooks, MCP servers, rules and skills from your Claude Code and Cursor config. grok is the delegatee here and the brief carries what it needs. Checked on 1.0.52: about 3,500 fewer input tokens per request.

Claude Code plugins under `~/.claude/plugins` have no per-run switch. To skip them, list them under `[plugins] disabled` in `~/.grok/config.toml`; that also applies to interactive grok. It saved about 1,100 more tokens per request here.

## Other notes

- `windowsHide: true` is set on every spawn. A dispatch from a backgrounded Bash call has no console, so without it Windows opens a terminal window for `grok.exe` that stays for the whole job.
- `grok --version` checks the binary on every dispatch because it is local and instant. `grok models` also reports login state but needs the network, so only `/grok:setup` calls it.

## Environment

| Variable | Effect |
| --- | --- |
| `GROK_BIN` | Full path to the grok binary; skips discovery. |
| `CGD_HOME` | Where jobs, papercuts and the release cache live. Default `%USERPROFILE%\.cgd`. |
| `CGD_RELEASE_CHECK` | `off` skips the npm registry check and the update line. |

## Licence

MIT.
