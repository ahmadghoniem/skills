# codex

**What it's for:** OpenAI's GPT models on the user's ChatGPT plan: careful multi-file
work and reviews (Astra), fast everyday edits (Sol).

**What it reads:** the repo's `AGENTS.md`, plus the user's `~/.codex/config.toml` (its MCP
servers, plugins and skills load as usual). It does not see `~/.claude/CLAUDE.md` or
`~/.claude/rules/`; whatever of that the result depends on goes in the brief.

**Model:** omit `--model` and mngr uses `gpt-6.2-sol`. `gpt-6.2-astra` is Codex's "most
capable model for complex coding". The ids and each one's effort levels are in
`~/.codex/models_cache.json`; a model codex doesn't list is refused before it starts.

**Effort:** `--effort low|medium|high|xhigh|max|ultra`, as the model allows. Without it
mngr passes the model's own default (low for Sol and Astra), never the one in
`config.toml`.

| Flag | Effect |
| --- | --- |
| `--model <id>` | A model id, such as `gpt-6.2-astra`. Defaults to `gpt-6.2-sol`. |
| `--effort <level>` | The reasoning effort; checked against the model's levels. |
| `--session <thread_id>` | Continue that thread, with the id from a run's first or last line. A follow-up goes in the prompt. |
