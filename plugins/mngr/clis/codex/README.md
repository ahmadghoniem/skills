# codex

Delegate coding tasks from Claude Code to OpenAI's [Codex CLI](https://github.com/openai/codex) on your ChatGPT plan, then review the diff and land it yourself.

Sibling of [grok](../grok/README.md), [agy](../agy/README.md) and [opencode](../opencode/README.md), and a member of the [council](../../council/README.md). One of the four CLIs [mngr](../../README.md) drives, built on its shared delegate run (`scripts/lib/shared/delegate.mjs`): this folder holds only what is codex's own, how to start it headless and how to read its output.

## Install

```bash
claude plugin marketplace add ahmadghoniem/skills
claude plugin install mngr@ahmadghoniem
```

Windows only. Requires the standalone Codex CLI at mngr's `engines.codex` or later (`%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`), signed in (`codex login`), and Node 18.18+. `CODEX_BIN` overrides the lookup. npm's `codex.cmd` works too but needs a shell to start, so the standalone binary is preferred.

## Commands

- **`/mngr:delegate codex <task>`** hands a task to codex in a background Bash call. The first line names the model and thread; `--session <id>` continues it. TaskStop on the background task stops a run.
- **`/mngr:setup codex`** checks the binary, the version and the sign-in.
- **`/mngr:update codex`** runs `codex update`, lists the releases since the version the plugin was last reviewed against, sets `engines.codex`, and prints the open papercuts.
- **`/mngr:papercut codex`** records what codex said blocked it, or closes papercuts once fixed.

| Flag | Effect |
| --- | --- |
| `--prompt-file <path>` | Read the brief from a file. |
| `--model <id>` | A model from `~/.codex/models_cache.json`. Defaults to `gpt-6.2-sol`. |
| `--effort <level>` | Checked against the model's levels; defaults to the model's own default. |
| `--session <thread_id>` | Continue that thread. |

## How codex is run

`codex exec --json --dangerously-bypass-approvals-and-sandbox -m <model> -c model_reasoning_effort=<level> -`, with the brief on stdin, which is then closed. A follow-up is `codex exec resume <thread_id> …`.

- **The prompt is never an argument:** passed that way, codex waits on an open stdin (openai/codex#20919).
- **No approvals, no sandbox,** as with the other CLIs: nobody can answer a prompt. The guard is that nothing is committed and Claude reads the diff.
- **No `--skip-git-repo-check` or `--trust`:** with approvals and the sandbox bypassed, codex starts outside a git repository anyway and reads the repo's `AGENTS.md` in an untrusted folder too (checked on 0.172). `--trust` would also save each folder into `config.toml` for good.
- **Your `config.toml` loads as usual,** MCP servers, plugins and skills included, so a run can use the browser and computer use like your own sessions. Measured on a trivial run, it adds about 1.5k tokens and 3 s. mngr always passes the model and effort, so the ones in `config.toml` never apply.
- **`CLAUDECODE` is removed** from codex's environment, so a `claude` command it runs isn't refused as nested.
- **Known:** `exec` still offers `request_user_input_async`, and no flag removes it. It returns at once without waiting; the questions note in every brief tells the model to list questions at the end instead.

A clean run prints codex's final messages, then `session: <id>`. `⚠ exit N` and `⚠ error: …` are added when a run fails; `contract.md` explains them to Claude, and `tests/contract.test.mjs` keeps it in step with the code.

## Council seat

`gpt-6.2-astra` at `low`, Astra's own default, written out so a change in Codex's default can't move it. The roster shows what is left in the 5-hour and weekly windows, read from `codex app-server` (`account/rateLimits/read`), which spends no tokens.
