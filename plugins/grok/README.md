# grok

Delegate coding tasks from Claude Code to the [Grok Build CLI](https://docs.x.ai/build/cli) (`grok`), then review the diff and land it yourself.

Claude writes the brief and reviews the result; grok does the editing in its own session. The plugin never commits.

Sibling of [agy](../agy/README.md) and [opencode](../opencode/README.md), and a member of the [council](../council/README.md). The plugin keeps only what Claude can't work out on its own: how to start grok, and how to read what grok says when a run goes wrong. Claude Code's background tasks already report when a run ends, keep its output and stop it, so the plugin keeps no job records.

## Install

```bash
claude plugin marketplace add ahmadghoniem/skills
claude plugin install grok@ahmadghoniem
```

Windows only. Requires the grok version in `package.json` `engines.grok` or later on `PATH` (or at `%USERPROFILE%\.grok\bin\grok.exe`), signed in with `grok login`, and Node 18.18+. `GROK_BIN` overrides the lookup.

## Commands

- **`/grok:delegate <task>`** hands a task to grok. Claude writes a brief to `~/.cgd/briefs/<name>.md` and runs it in a background Bash call. The output ends with `session: <id>`; `--session <id>` continues that session. TaskStop on the background task stops a run.
- **`/grok:setup`** checks the binary, the version (it fails on a grok older than `engines.grok`) and sign-in. `grok models` lists the models.
- **`/grok:update`** runs `grok update`, lists the releases since the version the plugin was last reviewed against, sets `engines.grok` to the new version, and reviews the plugin and the open papercuts against it. A test fails while the installed grok is newer than `engines.grok`.
- **`/grok:papercut`** records what grok said blocked it (`--text`), or closes papercuts once fixed (`--resolve <key|id> --note`).

```bash
node scripts/delegate.mjs -- --prompt-file C:/Users/me/.cgd/briefs/rename-client.md --effort low
```

| Flag | Effect |
| --- | --- |
| `--prompt-file <path>` | Read the brief from a file. |
| `--model <id>` | Pin a model. Omitted, grok uses the account default. |
| `--effort low\|medium` | grok's `--reasoning-effort`. Default `medium`. The xAI plan this runs on allows only `low` and `medium`. |
| `--session <uuid>` | Continue that grok session. |

## What the output looks like

A clean run prints grok's write-up, then `session: <id>`. A `⚠` line is added for each way a run can be wrong while still looking done: `⚠ stop reason: …` (not `end_turn`), `⚠ exit N`, and `⚠ error: …` (grok's error, or the end of stderr). `contract.md` explains them in the form Claude reads, and `tests/contract.test.mjs` keeps it in step with `WARNING_IDS` in `scripts/lib/render.mjs`. `⚠ error` lines are also appended to `~/.cgd/papercuts.jsonl`, which `/grok:update` reviews.

Once per release, a line after the output says a newer grok is out. The release data comes from the npm registry entry for `@xai-official/grok`, because grok publishes no changelog.

## How grok is run

- **`--prompt-file`**: the brief never goes on the command line. An inline task is written to a temp file, deleted afterwards.
- **`--output-format json`**: grok prints one object at the end with the text, stop reason, session id and spend, or an error object.
- **`--always-approve`**: a headless run cannot answer an approval prompt and would stall.
- **`--no-plan` and `--disallowed-tools`**: removes the 11 built-in tools a headless run can't use: image and video generation, `ask_user_question`, plan mode, `send_feedback` and the scheduler.
- **`--trust`**: loads the repo's `AGENTS.md`, top-level `CLAUDE.md` and `.grok/` config. **`--no-auto-update`**: the binary changes only with `/grok:update`. Both are missing from `grok --help`; the bundled user guide documents them.
- **`-s <uuid>`** on a new run, or **`--resume <uuid>`**: the session id is fixed before the run starts, so a run that dies can still be continued. `--continue` is never used: it takes the directory's newest session, which may belong to another Claude session.
- `--sandbox` is never passed: grok has no sandbox enforcement on Windows.

The environment sets `GROK_{CLAUDE,CURSOR}_{AGENTS,HOOKS,MCPS,RULES,SKILLS}_ENABLED=false`, so your Claude Code and Cursor agents, hooks, MCP servers, rules and skills stay out; the brief carries what grok needs. It also removes `CLAUDECODE`, which every Claude Code session sets: grok ignores it, but a `claude` command grok runs would take itself for a nested session and refuse to start. `GROK_AGENT`, `GROK_CONFIG`, `GROK_CONFIG_PATH` and `GROK_FOLDER_TRUST` are removed too, so an override in your shell cannot swap grok's agent or config or switch trust off.

Three sources have no per-run switch and still load: Claude Code plugins under `~/.claude/plugins` (`[plugins] disabled` in `~/.grok/config.toml`), skills in `~/.agents/skills` (`[skills] ignore`), and the `allow`/`deny` rules in `~/.claude/settings.json`.

## Environment

| Variable | Effect |
| --- | --- |
| `GROK_BIN` | Full path to the grok binary. |
| `CGD_HOME` | Where briefs, papercuts and the release cache live. Default `%USERPROFILE%\.cgd`. |
| `DELEGATE_RELEASE_CHECK` | `off` skips the release check and the update line. |

`scripts/lib/shared/` is a copy of `plugins/_shared`; edit it there and run `node tools/sync-shared.mjs`.

## Licence

MIT.
