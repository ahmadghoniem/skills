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

- **`/grok:delegate <task>`** — hand a task to grok. Claude runs it under a backgrounded Bash call, so you keep chatting while grok works and the harness announces the result — no polling.
- **`/grok:result [job-id]`** — print a finished job's record, or `--list` the tracked jobs.
- **`/grok:cancel [job-id]`** — terminate a running job and everything it spawned (SIGTERM, then SIGKILL after 5s; `taskkill /T /F` on Windows), so a cancelled run stops billing. Also reaps a record left stuck at `running` because its parent process died.
- **`/grok:resume [--resume=<id>] [follow-up]`** — continue the latest grok session for this repo, or a named one.
- **`/grok:setup`** — health-check the CLI: resolved binary, version, login state, available models.

Plus a **`grok-runner`** agent that shapes a task into a self-contained brief and dispatches it.

### `/grok:delegate`

```bash
/grok:delegate "Add retry-on-429 to src/api/client.ts. Verify with: pnpm test api"
/grok:delegate --effort high --prompt-file plan.md
/grok:delegate --resume "also cover the 503 path"
```

| Flag | Effect |
| --- | --- |
| `--model <id>` | Pin a model. Omitted, the plugin uses the newest one `grok models` reports. |
| `--effort <level>` | Grok's `--reasoning-effort`. Choose per task. |
| `--background` | Detach the worker. Scripting only — it severs the harness notification, which is what forces polling. |
| `--resume[=<id>]` | Continue the latest grok session, or a named one. Send only the delta. |
| `--fresh` | Start a new session regardless. |
| `--timeout <sec>` | Watchdog, default 3600. |
| `--prompt-file <path\|->` | Read the brief from a file or stdin. |
| `--no-git-check` | Allow dispatching outside a git repo. |

### `/grok:result`

Prints grok's write-up. `--list` shows the last 10 tracked jobs (`--all` for every one), **including running ones** — so it doubles as the way to recover a job id.

## What the output looks like

On a clean run: grok's write-up, and nothing else. No status table, no file list, no model id, no
timestamps, no cost or token figures. `git status` and `git diff` are one call away and are the
actual ground truth; a formatted summary of them is just something else to read.

What does get surfaced is the set of ways a run can be wrong while grok still calls it done. Each
is its own `⚠` line, and any can fire alone:

| Line | Means |
| --- | --- |
| `⚠ stop reason: …` | Grok's own verdict, when it is not `end_turn`. |
| `⚠ exit N` | The process exit code. Independent of the above — they disagree in both directions. |
| `⚠ run was killed before finishing` | The watchdog fired; output may be incomplete. |
| `⚠ N commands exited non-zero` | Terminal commands that failed, with up to ten lines of output each. |
| `⚠ no session id was captured` | A killed run never reached the `end` event, so this job cannot be resumed. |

The failed-command list is reported, never fatal. A non-zero exit is routinely intentional — `grep`
finding nothing, a deliberately red test in a TDD cycle, a `command -v` probe — so failing the job
on it would cry wolf often enough to be ignored. Job status comes from grok's own stop reason; the
list is there so you can check the claims in the write-up against what actually happened. On the
very first end-to-end run of this plugin, grok's summary read as a success while three commands had
in fact exited 1.

## Design notes

- **Non-blocking without detaching.** The job runs in the foreground of its own process under a backgrounded Bash call, so the harness reports the exit. Detaching (`--background`) would sever that and leave polling as the only option.
- **`windowsHide: true` on every spawn that could create a console.** A detached worker has no console of its own, so Windows hands the `grok.exe` it spawns a brand new one — a Windows Terminal window that opens on dispatch and lives as long as the job. The CLI spawn is the load-bearing one; the probe and worker spawns set it too.
- **The brief goes via `--prompt-file`, never argv.** It stays out of the host process list, is not bounded by the OS argument-length cap, and a brief starting with `-` cannot be misread as a flag.
- **`--always-approve` is unconditional.** A headless run has no way to answer an approval prompt, so without it grok stalls. The guard against a bad edit is not a dialog nobody can see — it is that this plugin never commits, and you read the diff.
- **`--sandbox` is never passed.** Grok accepts an unknown profile name silently and runs anyway (verified: `--sandbox __invalid__` produced no error and no refusal), so it reads like a guarantee while providing none. Worse than no guard.
- **No hardcoded default model.** `grok models` is consulted and the newest id wins, cached for a day. A pinned default in the docs goes stale the moment xAI ships the next model.
- **`grok --version` probes liveness; `grok models` probes login.** They answer different questions and cost different amounts. `--version` is local and instant, so it gates every dispatch. `grok models` is a network round-trip that also reports auth state (`You are logged in with grok.com.`, exit 0 — verified on 1.0.5), so `/grok:setup` uses it and nothing on the hot path does.

## Environment

| Variable | Effect |
| --- | --- |
| `GROK_BIN` | Full path to the grok binary; skips discovery. |
| `CGD_DEFAULT_MODEL` | Default model when `--model` is omitted. |
| `CGD_HOME` | Job registry location. Default `~/.cgd`. |

## Licence

MIT.
