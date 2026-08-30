# snapshot-recall

Carry one brief across `/clear` in Claude Code, then throw it away.

`/compact` is lossy — the third compact is a summary of a summary of a summary. This is the alternative: while the session is still sharp, write one short brief, clear the conversation completely, and have the fresh session start with that brief already in context. The brief is ephemeral — injected once, then deleted.

```
work  →  /compact (optional; twice max)  →  /snapshot  →  /clear  →  /recall
```

## How it works

1. **`/snapshot [focus]`** writes one brief to `%TEMP%\claude-snapshot-<project-folder>.md`: State, Decisions, Still open, Files. Sections with nothing real in them are left out entirely, headings included, so the brief can't pad itself into inventing work nobody settled on. Pass a focus and it scopes the whole brief, the way `/compact` takes instructions. Overwriting, not appending — there is only ever one live brief, and nothing lands in your repo.

2. **`/clear`** wipes the conversation. The temp file is the only thing that survives it.

3. A **`SessionStart` hook with `matcher: clear`** fires right after the wipe. It injects the whole brief as `additionalContext` and deletes the file, so a later `/clear` with no new snapshot gives you a real blank slate. A `SessionStart` hook is the one supported place to add text to a session as it starts, which is why the mechanism hangs off it.

4. **`/recall`** has the fresh session orient before touching anything: it reads the brief and the relevant files, then either proposes a starting point in one line and waits for your go-ahead, or asks about a genuine gap the brief left. No edits on that first turn. Claude Code won't begin a turn without a user message, and a skill autocompletes where a typed word doesn't.

Both skills are user-invoked only: Claude can't fire them on its own, and they don't take up room in the skill list it reads every turn. Only you, through `/snapshot` and `/recall`. The file is named after the project folder, so briefs from different projects stay separate.

## Install

`snapshot` and `recall` ship in the `ahmadghoniem-skills` plugin:

```
/plugin marketplace add ahmadghoniem/skills
/plugin install ahmadghoniem-skills@ahmadghoniem
```

The hook is the one piece the plugin cannot wire for you, because a `SessionStart` hook needs an absolute path in your own settings. Copy the script out and point at it:

```
skills/snapshot/scripts/load-snapshot.ps1  ->  ~/.claude/hooks/load-snapshot.ps1
```

Then merge the `hooks` block from [`settings.snippet.json`](./settings.snippet.json) into `~/.claude/settings.json`, changing the `-File` path to your own home directory:

```json
"-File", "C:/Users/YOU/.claude/hooks/load-snapshot.ps1"
```

It has to be an absolute path. `${CLAUDE_PROJECT_DIR}` resolves to whatever project is currently open, not to where the hook actually lives.

Windows / PowerShell.

## License

MIT
