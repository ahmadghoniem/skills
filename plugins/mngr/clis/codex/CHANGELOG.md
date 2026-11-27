# Changelog

## mngr 0.3.0

- **codex joins mngr** as its fourth CLI, built on the shared delegate run: `/mngr:delegate codex`, `/mngr:setup codex`, `/mngr:update codex` (`codex update`, releases from GitHub's `rust-v*` tags) and `/mngr:papercut codex`. Checked against codex-cli 0.172.0, the standalone `codex.exe`.
- The prompt goes on stdin, which is then closed: passed as an argument, codex waits on an open stdin (openai/codex#20919, still open in 0.172).
- `--dangerously-bypass-approvals-and-sandbox`, like the other CLIs' no-prompt flags. It also lets codex start outside a git repository, so `--skip-git-repo-check` isn't passed, and codex reads `AGENTS.md` in untrusted folders, so neither is `--trust` (which would also write each folder into `config.toml` for good).
- Your `config.toml` loads as usual (MCP servers, plugins, skills, computer and browser use): measured, it adds about 1.5k tokens and 3 s to a run. The model and effort are always passed, so its `model` and `model_reasoning_effort` never apply.
- Known: `exec` still offers `request_user_input_async`, which no flag removes. It returns at once without waiting, and the questions note tells the model to list questions instead.
- A council seat: `gpt-6.2-astra` at `low`, Astra's own default. The roster reads what is left in the 5-hour and weekly windows from `codex app-server` (`account/rateLimits/read`), which spends no tokens.
