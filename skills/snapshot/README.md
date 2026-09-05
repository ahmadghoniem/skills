# snapshot-recall

Carry one brief across `/clear` in Claude Code, then throw it away.

`/compact` is lossy — the third compact is a summary of a summary of a summary. This is the alternative: while the session is still sharp, write one short brief, clear the conversation completely, and have the fresh session start with that brief already in context. The brief is ephemeral — injected once, then deleted.

```
work  →  /compact (optional; twice max)  →  /snapshot  →  /clear  →  /recall
```

## How it works

1. A **`PostCompact` hook** counts the compactions already in the session transcript and, from the second one on, prints a line reminding you to snapshot. It is the only thing enforcing the "twice max" above. The count needs no state file: each compaction leaves one `compact_boundary` marker in the transcript, and `/clear` starts a fresh transcript, so it resets on its own. `PostCompact` output goes to you and never to Claude — which is the right audience, since `/snapshot` is user-invoked only.

2. **`/snapshot [focus]`** writes one brief to `%TEMP%\claude-snapshot-<project-folder>.md`: State, Running, Decisions, Still open, Artifacts, Files. Sections with nothing real in them are left out entirely, headings included, so the brief can't pad itself into inventing work nobody settled on. Pass a focus and it scopes the whole brief, the way `/compact` takes instructions. Overwriting, not appending — there is only ever one live brief, and nothing lands in your repo.

3. **`/clear`** wipes the conversation. The temp file is the only thing that survives it.

4. A **`SessionStart` hook with `matcher: clear`** fires right after the wipe. It injects the whole brief as `additionalContext` and deletes the file, so a later `/clear` with no new snapshot gives you a real blank slate. A `SessionStart` hook is the one supported place to add text to a session as it starts, which is why the mechanism hangs off it.

   A brief nobody came back for **expires after 12 hours** (`$ttlHours` in the script) and is wiped unread. Snapshot, then close the terminal or change your mind, and it would otherwise sit in temp indefinitely.

   **Artifacts** are in the brief because they outlive the session without following it. An artifact you published in session one is still live at its URL, but session two has never seen that URL — ask it to "update the dashboard" and it publishes a *second* artifact under a new link. So the brief carries the URL and a short brief of what it is. `/recall` doesn't open it on the first turn: a whole page of HTML in a fresh context is a bad trade before you know you'll touch it, and it reads the thing anyway at the moment it goes to change it.

5. **`/recall`** has the fresh session orient before touching anything: it reads the brief and the relevant files, then either proposes a starting point in one line and waits for your go-ahead, or asks about a genuine gap the brief left. No edits on that first turn. Claude Code won't begin a turn without a user message, and a skill autocompletes where a typed word doesn't.

Both skills are user-invoked only: Claude can't fire them on its own, and they don't take up room in the skill list it reads every turn. Only you, through `/snapshot` and `/recall`. The file is named after the project folder, so briefs from different projects stay separate.

## Install

`snapshot` and `recall` ship in the `kit` plugin:

```
/plugin marketplace add ahmadghoniem/skills
/plugin install kit@ahmadghoniem
```

The hook is the one piece the plugin cannot wire for you, because a `SessionStart` hook needs an absolute path in your own settings. Copy the script out and point at it:

```
skills/snapshot/scripts/load-snapshot.ps1  ->  ~/.claude/hooks/load-snapshot.ps1
skills/snapshot/scripts/compact-nudge.ps1  ->  ~/.claude/hooks/compact-nudge.ps1
```

Then merge the `hooks` block from [`settings.snippet.json`](./settings.snippet.json) into `~/.claude/settings.json`, changing the `-File` path to your own home directory:

```json
"-File", "C:/Users/YOU/.claude/hooks/load-snapshot.ps1"
```

It has to be an absolute path. `${CLAUDE_PROJECT_DIR}` resolves to whatever project is currently open, not to where the hook actually lives.

Windows / PowerShell.

## License

MIT
