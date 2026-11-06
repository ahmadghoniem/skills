---
name: recall
description: Search and read past Claude Code sessions from their transcripts. Use whenever the user mentions a transcript ("the recent transcript", "look into the transcripts related to X", "ground yourself with the transcript", "where we left off", "we tried") or you need a decision, error, number or file from an earlier session.
---

`python "<this skill's base directory>/scripts/recall.py" <command>` parses the
transcripts in `~/.claude/projects` for you and leaves out the current session. Use it
instead of writing your own JSONL parser.

- `recent [-n 3] [--all]`: this project's latest sessions, with dates and last prompts.
- `grep TERM... [--role you,claude,call,out,summary] [--since D] [--until D] [--project P]`:
  sessions holding every term, oldest first, each match one line with its role, time
  and receipt. `re:PATTERN` for a regex.
- `calls TERM... [--tool Bash] [--errors]`: one line per tool call whose input or
  result holds the terms: time, receipt, tool, ok/ERR, input => result. Pipe it to
  `awk`/`uniq -c` to count.
- `show ID [--prompts | --around LINE | --tail N] [-C 3] [--tools]`: read a session.
  Tool calls are folded unless `--tools`.

Output never cuts silently; it says what it left out and how to get it. Every hit has a
receipt `id:line`: open it with `show id --around line` before citing it, and quote it.
Older sessions can be outdated; check the newer ones. Prompts of sessions whose
transcript was deleted (before September 2026) are in `~/.claude/history.jsonl`, one JSON
line each; search it with `rg`.
