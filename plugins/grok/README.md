# claude-grok-delegate

Delegate coding tasks from Claude Code to the [Grok Build CLI](https://docs.x.ai/build/cli) (`grok`), then review the diff and land it yourself.

Claude plans and reviews; grok does the typing in its own session. The plugin never commits — that stays with you.

Sibling of [claude-cursor-delegate](https://github.com/ahmadghoniem/claude-cursor-delegate), which does the same for Cursor CLI. The two are independent: install either, or both.

## Install

```bash
claude plugin marketplace add ahmadghoniem/claude-grok-delegate
claude plugin install grok@claude-grok-delegate
```

Requires the Grok CLI on `PATH` (or at `~/.grok/bin/grok`), authenticated with `grok login`. Node 18.18+.

If a Claude Code session was already open when you installed grok, its `PATH` will not have picked up the installer's change — the plugin checks `~/.grok/bin` directly for exactly that reason, and `GROK_BIN` overrides both.

## Commands

- **`/grok:delegate <task>`** — hand a task to grok. Blocks and prints the result inline by default; `--background` returns immediately.
- **`/grok:result [job-id]`** — print a finished job's record, or `--list` the tracked jobs.
- **`/grok:cancel [job-id]`** — terminate a running job and everything it spawned (SIGTERM, then SIGKILL after 5s; `taskkill /T /F` on Windows), so a cancelled run stops billing. Also reaps a record left stuck at `running` because its parent process died.
- **`/grok:resume [--resume=<id>] [follow-up]`** — continue the latest grok session for this repo, or a named one.
- **`/grok:setup`** — health-check the CLI: resolved binary, version, login state, available models.

Plus a **`grok-runner`** agent that shapes a task into a self-contained brief and dispatches it.

### `/grok:delegate`

```bash
/grok:delegate "Add retry-on-429 to src/api/client.ts. Verify with: pnpm test api"
/grok:delegate --effort high --background --prompt-file plan.md
/grok:delegate --resume "also cover the 503 path"
```

| Flag | Effect |
| --- | --- |
| `--model <id>` | Pin a model. Omitted, the plugin uses the newest one `grok models` reports. |
| `--effort <level>` | Grok's `--reasoning-effort`. Choose per task. |
| `--background` | Return immediately; collect with `/grok:result <id>`. |
| `--wait` | Force the foreground even alongside `--background`. |
| `--resume[=<id>]` | Continue the latest grok session, or a named one. Send only the delta. |
| `--fresh` | Start a new session regardless. |
| `--timeout <sec>` | Watchdog, default 3600. |
| `--prompt-file <path\|->` | Read the brief from a file or stdin. |
| `--no-git-check` | Allow dispatching outside a git repo. |

### `/grok:result`

Prints the full record: status, model, cost, files touched, failed commands, grok's summary, and the session id to resume from. `--list` shows the last 10 tracked jobs (`--all` for every one), **including running ones** — so it doubles as the way to recover the id of a `--background` job.

## What it reports that grok's summary doesn't

Grok's `streaming-json` stream carries an exit code for every terminal command it runs. The plugin surfaces the non-zero ones in a **`⚠ Commands that exited non-zero`** section.

This is reported, never fatal. A non-zero exit is routinely intentional — `grep` finding nothing, a deliberately red test in a TDD cycle, a `command -v` probe — so failing the job on it would cry wolf often enough to be ignored. Job status comes from grok's own stop reason; the failed-command list is there so you can check the claims in the summary against what actually happened. On the very first end-to-end run of this plugin, grok's summary read as a success while three commands had in fact exited 1.

Cost is reported too: grok bills per run and puts the figure in its terminal event.

## Design notes

- **The brief goes via `--prompt-file`, never argv.** It stays out of the host process list, is not bounded by the OS argument-length cap, and a brief starting with `-` cannot be misread as a flag.
- **`--always-approve` is unconditional.** A headless run has no way to answer an approval prompt, so without it grok stalls. The guard against a bad edit is not a dialog nobody can see — it is that this plugin never commits, and you read the diff.
- **`--sandbox` is never passed.** Grok accepts an unknown profile name silently and runs anyway (verified: `--sandbox __invalid__` produced no error and no refusal), so it reads like a guarantee while providing none. Worse than no guard.
- **No hardcoded default model.** `grok models` is consulted and the newest id wins, cached for a day. A pinned default in the docs goes stale the moment xAI ships the next model.
- **`grok models` is not a health check.** It prints `You are not authenticated.` on a working, authenticated install. `grok --version` is used instead.

## Environment

| Variable | Effect |
| --- | --- |
| `GROK_BIN` | Full path to the grok binary; skips discovery. |
| `CGD_DEFAULT_MODEL` | Default model when `--model` is omitted. |
| `CGD_HOME` | Job registry location. Default `~/.cgd`. |

## Licence

MIT.
