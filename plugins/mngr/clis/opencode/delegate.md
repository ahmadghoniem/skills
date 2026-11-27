# opencode

**What it's for:** well-specified, high-volume work, and reaching models the other CLIs
don't have (DeepSeek, Kimi, GLM, Qwen through the user's providers).

**What it reads:** the repo's `AGENTS.md`. It does not see `~/.claude/CLAUDE.md` or
`~/.claude/rules/`; whatever of that the result depends on goes in the brief.

**Model:** `--model` is required. opencode runs on API keys, which bill per token, so mngr
picks no model for it and refuses a run without one. Use the model the user named; if they
named none, ask. `opencode models` lists the ids (`provider/model`, `#variant` for an
effort level). Never invent one.

| Flag | Effect |
| --- | --- |
| `--model <id>` | Required. A `provider/model` id from `opencode models`. |
| `--session <ses_id>` | Continue that session, with the id from a run's first or last line. A follow-up goes in the prompt. |
