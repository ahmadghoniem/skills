# lean-claude

`/lean-claude` measures what every Claude Code request carries before you type
anything, shows how often you used each piece, and applies the cuts you pick.

On the author's machine the same probe went from 39,742 to about 12,970 prompt tokens
per request (67%): unused tools denied, Artifact and PowerShell off, the short system
prompt, unused plugins and skills removed.

## How it measures

`scripts/lean.mjs report` starts `claude -p` with `ANTHROPIC_BASE_URL` pointed at a
local server. The server records the first request and answers with an error, so no
model runs. The request is split into system prompt sections, tools, skill and agent
listing lines, MCP instructions and instruction files. Each piece is counted by
removing it and asking Anthropic's `count_tokens` endpoint, which is free and uses the
login Claude Code sent. If that fails, 3.5 characters count as one token.

Switches (short system prompt, Artifact, PowerShell, Cron, claude.ai skills and
connectors, Explore/Plan) are measured by capturing again with each one set. Tools you
already removed are sized from a capture with an empty config, so the report can say
what turning each back on would cost. The short system prompt is also captured unset,
to tell whether the current model already gets it by default. The report flags a skill
listing that went over its budget (skills listed by name only) and skills listed twice.

Usage comes from the transcripts in `~/.claude/projects`: tool calls, `Skill` calls,
typed slash commands, subagent types and MCP servers, counted in calls and in sessions.
Every transcript on disk is read unless `--days` narrows it; Claude Code already deletes
old ones (`cleanupPeriodDays`), so what's left is the most data there is.

`stretch` replays the same transcripts at API prices: how much further the usage limit
goes once `--saved` tokens leave every request, what prompt suggestions cost at most,
what returning to a conversation after its cache expired cost (and what `/compact`
before leaving would have saved), and how often Claude wrote one-off edit scripts and
how many failed.

```
node skills/lean-claude/scripts/lean.mjs report [--days N] [--json out.json] [--estimate]
node skills/lean-claude/scripts/lean.mjs stretch --saved N [--days N]
node skills/lean-claude/scripts/lean.mjs capture [--out req.json] [--settings '{"k":v}']
```

Requires Node 18+ and `claude` on `PATH`.
