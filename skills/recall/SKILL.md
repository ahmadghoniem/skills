---
name: recall
description: Search and read past Claude Code sessions from their transcripts. Use whenever the user mentions a transcript ("the recent transcript", "look into the transcripts related to X", "ground yourself with the transcript", "where we left off", "we tried") or you need a decision, error, number or file from an earlier session.
---

`recall.py` parses the transcripts in `~/.claude/projects` for you and leaves out the
current session. Use it instead of writing your own JSONL parser. The path has a space
in it, so set it once with straight quotes and quote it every time:

    R="<this skill's base directory>/scripts/recall.py"; python "$R" grep TERM

- `recent [-n 3] [--all]`: this project's latest sessions, with dates and last prompts.
- `grep TERM... [--role you,claude,call,out,summary,cmd] [--since D] [--until D] [--project P,P]`:
  sessions holding every term, oldest first, each match one line with its role, time
  and receipt. `re:PATTERN` for a regex. `cmd` is a slash command's output, e.g. `/context`.
- `calls TERM... [--tool Bash] [--errors]`: one line per tool call whose input or
  result holds the terms: time, receipt, tool, ok/ERR, input => result. Pipe it to
  `awk`/`uniq -c` to count.
- `show ID [--prompts | --around LINE [-C 3] | --tail N | --line N] [--tools] [--max N]`: read a
  session. `--line` prints one line in full. Tool calls are folded unless `--tools`;
  `--max` cuts each message and tool output at N chars and says so.

`grep` and `calls` search every project's main sessions. Start without `--project`
unless the user named one, then narrow to the projects the first results show. Pass
`--since`/`--until` only when the user gives a time. `--self` searches this session up
to its latest compaction, for what the summary dropped. Subagent transcripts are left
out; `--subagents all` or `--subagents ID` adds them. Earlier recall output is left out
too; `--echoes` shows what an earlier search returned, but the original lines are the
source, so open those.

Output never cuts silently; it says what it left out and how to get it. When a search
spans dozens of sessions, it says so: split the sessions across parallel Haiku
subagents (by date range or project), each reporting receipts, and verify the ones you
use. Every hit has a receipt `id:line`: open it with `show id --around line` or
`--line line` before citing it, and quote it. Older sessions can be outdated; check the
newer ones. Prompts of sessions whose transcript was deleted (before September 2026) are
in `~/.claude/history.jsonl`, one JSON line each; search it with `rg`.
