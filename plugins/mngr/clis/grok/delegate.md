# grok

**What it's for:** well-specified, high-volume work that would otherwise consume context
better spent on judgement.

**What it reads:** the repo's `AGENTS.md`, top-level `CLAUDE.md` and `.grok/` config. It
does not see `~/.claude/CLAUDE.md`, `~/.claude/rules/`, the repo's `.claude/` rules and
skills, or any Claude Code or Cursor skill, hook, MCP server or plugin. Whatever of that
the result depends on goes in the brief.

**Model and effort:** omit `--model`. grok then uses the account default that `grok models`
reports, so a new xAI model applies without a plugin change. Pass a model only when the
user names one, and never invent an id; `grok models` lists the ones the account has.

`--effort` defaults to `medium`. Pass `--effort low` for mechanical work such as renames,
moves and boilerplate. The xAI plan this runs on allows only `low` and `medium`.

| Flag | Effect |
| --- | --- |
| `--model <id>` | Pin a model from `grok models`. Omit unless the user chose one. |
| `--effort <level>` | `low` or `medium`, passed to grok's `--reasoning-effort`. Defaults to `medium`. |
| `--session <uuid>` | Continue that grok session, with the id from a run's first or last line. A follow-up goes in the prompt; with none, grok is told to continue where it left off. |

To see past grok sessions, `grok sessions list`; to read one, `grok export <id>`.
