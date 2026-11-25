# opencode

**What it's for:** well-specified, high-volume work, and reaching models the other CLIs
don't have (DeepSeek, Kimi, GLM, Qwen through the user's providers).

**What it reads:** the repo's `AGENTS.md`. It does not see `~/.claude/CLAUDE.md` or
`~/.claude/rules/`; whatever of that the result depends on goes in the brief.

**Model:** omit `--model`: mngr uses `nebius/deepseek-ai/DeepSeek-V4.1-Flash-1017`. mngr
always passes a model, because opencode with none picks one of its configured models on
its own, which may be metered. Pass `--model` only when the user names one;
`opencode models` lists the ids (`provider/model`, `#variant` for an effort level). Never
invent one.

| Flag | Effect |
| --- | --- |
| `--model <id>` | A `provider/model` id from `opencode models`. |
| `--session <ses_id>` | Continue that session, with the id from a run's last line. A follow-up goes in the prompt. |
