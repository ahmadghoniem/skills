# lean-claude

`/lean-claude` measures what every Claude Code request carries before you type
anything, shows how often you used each piece, and applies the cuts you pick.

On a stock install with Opus 5.5 (Claude Code 2.1.284), the first request went from
30,875 tokens to 7,093 (−77%): Artifact, PowerShell and unused tools off, bundled
skills made typable-only, claude.ai skills and connectors off, built-in git
instructions and Explore/Plan off.

## How it measures

`scripts/lean.mjs report` starts `claude -p` with `ANTHROPIC_BASE_URL` pointed at a
local server. The server records the first request and answers with an error, so no
model runs. The request is split into system prompt sections, tools, skill and agent
listing lines, MCP instructions and instruction files. Each piece is counted by
removing it and asking Anthropic's `count_tokens` endpoint, which is free and uses the
login Claude Code sent. If that fails, 3.5 characters count as one token.

Switches (short system prompt, built-in git instructions, Claude attribution in
commits, Artifact, PowerShell, Cron, claude.ai skills and connectors, Explore/Plan)
are measured by capturing again with each one set. Tools you already removed are sized from a capture with an empty config,
so the report can say what turning each back on would cost. The short system prompt is
also captured unset, to tell whether the current model already gets it by default
(Opus 4.8 and later and Sonnet 5.5 do; Opus 4.7 and earlier, Sonnet 5 and Haiku 4.5
don't, and the report gives what it would save on those). The
report flags a skill listing that went over its budget (skills listed by name only) and
skills listed twice.

Usage comes from the transcripts in `~/.claude/projects`: tool calls, `Skill` calls,
typed slash commands, subagent types and MCP servers, counted in calls and in sessions.
Every transcript on disk is read unless `--days` narrows it; Claude Code already deletes
old ones (`cleanupPeriodDays`), so what's left is the most data there is.

`stretch` replays the same transcripts at API prices: how much further the usage limit
goes once `--saved` tokens leave every request, what prompt suggestions cost at most,
what returning to a conversation after its cache expired cost (and what `/compact`
before leaving would have saved), how often Claude wrote one-off edit scripts and
how many failed, and what compacting at 130k, 165k or 200k would cost against where
the user compacts now.

`compare` takes the report from before the cuts and the one after, and gives the
measured saving, each change with its own saving, and how much of the total no change
accounts for. When that gap is too large to trust it says so, and the skill works the
figures out from the two reports instead.

```
node skills/lean-claude/scripts/lean.mjs report [--days N] [--json out.json] [--estimate]
node skills/lean-claude/scripts/lean.mjs stretch --saved N [--days N]
node skills/lean-claude/scripts/lean.mjs compare before.json after.json
node skills/lean-claude/scripts/lean.mjs capture [--out req.json] [--settings '{"k":v}']
```

Requires Node 18+ and `claude` on `PATH`.
