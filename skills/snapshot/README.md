# snapshot-recall

Carry one brief across `/clear` in Claude Code, then throw it away.

`/compact` is lossy and it nests — the third compact is a summary of a summary of a summary. This is the alternative: write one short brief while the session is still sharp, wipe the conversation for real, and have the fresh session start with that brief already in context.

```
work  →  /compact (at most twice)  →  /snapshot  →  /clear  →  /recall
```

## How it works

1. **`/snapshot [what the next session should do first]`** writes one brief to `%TEMP%\claude-snapshot-<project-folder>.md`. It leads with **Next action**, then Goal, Done, Still open, Files, Decisions, Suggested skills, Open questions. Overwriting, not appending — there is only ever one live brief, and nothing lands in your repo.

2. **`/clear`** wipes the conversation. The temp file is the only thing that survives it.

3. A **`SessionStart` hook with `matcher: clear`** fires right after the wipe. It injects the whole brief as `additionalContext` and deletes the file — read once, then gone, so a later `/clear` with no new snapshot gives you a real blank slate. `/clear` is a built-in and can't be overridden; this hook is the documented seam.

4. **`/recall`** tells the fresh session to start on **Next action**. Claude Code won't begin a turn without a user message, and a skill autocompletes where a typed word doesn't.

Both skills are `disable-model-invocation: true` — user-invoked only, never sitting in the model's skill index. Nothing is snapshotted automatically, and the mailbox is named per project so two repos don't clobber each other.

## Install

Copy into your home Claude directory so it works in every project:

```
.claude/skills/snapshot/  →  ~/.claude/skills/snapshot/
.claude/skills/recall/    →  ~/.claude/skills/recall/
.claude/hooks/            →  ~/.claude/hooks/
```

Then merge the block in `settings.snippet.json` into `~/.claude/settings.json`, **changing the `-File` path to your own home directory**. It must be an absolute path: `${CLAUDE_PROJECT_DIR}` resolves to whatever project is open, which is not where the hook lives.

Windows / PowerShell.

## License

MIT
