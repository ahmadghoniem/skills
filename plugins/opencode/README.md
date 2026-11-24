# opencode

Delegate coding tasks from Claude Code to the [opencode](https://opencode.ai) CLI, then review the diff and land it yourself. opencode reaches the models the other delegates don't: DeepSeek, Kimi, GLM and Qwen through your own provider keys.

Sibling of [grok](../grok/README.md) and [agy](../agy/README.md), and a member of the [council](../council/README.md). The plugin keeps only what Claude can't work out on its own: how to start opencode headless, and how to read its failures. Claude Code's background tasks already report when a run ends, keep its output and stop it, so the plugin keeps no job records.

## Install

```bash
claude plugin marketplace add ahmadghoniem/skills
claude plugin install opencode@ahmadghoniem
```

Windows only. Requires opencode `engines.opencode` or later on `PATH` (`bun add -g @opencode/cli`), at least one provider key (`opencode auth list`), and Node 18.18+. `OPENCODE_BIN` overrides the lookup.

## Commands

- **`/opencode:delegate <task>`** hands a task to opencode in a background Bash call. The output ends with `session: <id>`; `--session <id>` continues it. TaskStop on the background task stops a run.
- **`/opencode:setup`** checks the binary and the version. `opencode models` lists the models.
- **`/opencode:update`** runs `opencode upgrade`, lists the releases since the version the plugin was last reviewed against, sets `engines.opencode`, and prints the open papercuts.
- **`/opencode:papercut`** records what opencode said blocked it, or closes papercuts once fixed.

| Flag | Effect |
| --- | --- |
| `--prompt-file <path>` | Read the brief from a file. |
| `--model <provider/model>` | Default `nebius/deepseek-ai/DeepSeek-V4.1-Flash-1017`. |
| `--session <ses_id>` | Continue that session. |

## How opencode is run

`opencode run --standalone --format json --dangerously-skip-permissions --model <id> --session <ses_id> -f <brief> -- <message>`

- **`--standalone`** runs the turn in a private server under the run. Without it the turn runs in opencode's background service, and stopping the run leaves the turn and its shell commands going there (found by the lifecycle test: a `ping` survived TaskStop under `opencode serve --service`).
- **`--model` is always passed.** With none, opencode picks one of its configured models on its own, which may be metered.
- **`--dangerously-skip-permissions`** approves every permission not explicitly denied; nobody can answer a prompt in a headless run. It is a hidden alias of `--auto`, named like agy's flag.
- **`-f <brief>`** attaches the brief, read in full; the message only points at it. `-f` swallows the tokens after it, so `--` comes before the message. An inline task goes through a temp file.
- **`--session ses_…`** names the session before the run starts, so a run that dies can still be continued. opencode creates a session it does not know and refuses ids that do not start with `ses`. `--continue` is never used: it takes the newest session, which may belong to another Claude session.
- **`--format json`** prints one event per line. The write-up is the `text` parts; an `error` event (`provider.quota`, `provider.auth`, `provider.no-route`) says why a run failed. A tool part whose state is `error` could not run at all; a command that exits non-zero still reports `completed`.
- `CLAUDECODE` is removed from opencode's environment, so a `claude` command it runs is not refused as a nested session.

## Output and papercuts

A clean run prints the write-up, then `session: <id>`. `⚠ exit N` and `⚠ error: …` are added when a run fails; `contract.md` explains them to Claude, and `tests/contract.test.mjs` keeps it in step with `WARNING_IDS`. Errors and tools that could not run (one row per tool) go to `~/.cod/papercuts.jsonl`, which `/opencode:update` reviews. Once per release, a line after the output says a newer opencode is out (from the npm registry entry for `@opencode/cli`).

## Environment

| Variable | Effect |
| --- | --- |
| `OPENCODE_BIN` | Full path to the opencode binary. |
| `COD_HOME` | Where briefs, papercuts and the release cache live. Default `%USERPROFILE%\.cod`. |
| `DELEGATE_RELEASE_CHECK` | `off` skips the release check and the update line. |

`scripts/lib/shared/` is a copy of `plugins/_shared`; edit it there and run `node tools/sync-shared.mjs`.

## Licence

MIT.
