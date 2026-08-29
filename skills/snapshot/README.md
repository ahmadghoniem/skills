# snapshot-recall

Carry one brief across `/clear` in Claude Code, then throw it away.

`/compact` is lossy and it nests — the third compact is a summary of a summary of a summary. This is the alternative: while the session is still sharp, write one short brief to a temp file, wipe the conversation for real, and have the fresh session start with that brief already in context.

```
work  →  /compact (at most twice)  →  /snapshot  →  /clear  →  /recall
```

## How it works

1. **`/snapshot [what the next session should do first]`** writes one brief to `%TEMP%\claude-snapshot-<project-folder>.md`. It leads with **Next action**, then Goal, Done, Still open, Files, Decisions, Suggested skills, Open questions. Overwriting, not appending — there is only ever one live brief. Nothing lands in your repo.

2. **`/clear`** wipes the conversation. The temp file is the only thing that survives it.

3. A **`SessionStart` hook with `matcher: clear`** fires right after the wipe. It reads the file, injects the whole body as `additionalContext`, and deletes it. The brief is in the new window before you type anything.

4. **`/recall`** tells the fresh session to start on **Next action**. It exists because Claude Code will not begin a turn without a user message — and because a skill autocompletes and can define what the word means.

## Install

Copy into your home Claude directory so it works in every project:

```
.claude/skills/snapshot/  →  ~/.claude/skills/snapshot/
.claude/skills/recall/    →  ~/.claude/skills/recall/
.claude/hooks/            →  ~/.claude/hooks/
```

Then merge the block in `settings.snippet.json` into `~/.claude/settings.json`, **changing the `-File` path to your own home directory**. It must be an absolute path: `${CLAUDE_PROJECT_DIR}` resolves to whatever project is open, which is not where the hook lives.

Windows / PowerShell. On macOS or Linux, port `load-snapshot.ps1` — it is ~20 lines and the JSON contract is the same.

## Why it is built this way

**Why not just override `/clear`?** You can't. It is a built-in; no plugin, skill, or settings key replaces it, gives it a file argument, or makes it auto-send a first prompt. `SessionStart` + `matcher: clear` is the documented seam — it fires after the wipe and can return `additionalContext`. That is the API, not a workaround.

**Why a file, and why temp?** After `/clear` the conversation is gone. Disk is the only thing left. Temp rather than the repo because a brief in the repo goes stale, shows up in search, and wants gitignore rules. `%TEMP%\claude-snapshot-<folder>.md` is per-project, so two repos don't clobber each other, and it never touches git.

**Why delete after reading?** Read once, then gone. A later `/clear` with no new snapshot gives you a real blank slate. The matcher is `clear` only, not `startup` — a new session tomorrow should not eat last night's leftover mailbox.

**Why inject the body instead of a path?** If the hook only handed over a path, Claude would have to `Read` a file the hook is about to delete. Race, extra tool call, extra chance it stalls waiting for you. Injecting the body means the brief is already there.

**Why the wrapper text around the brief?** `SessionStart`-injected summaries get read as live instructions, and the model re-runs old skill invocations. The preamble pins it: this is a prior session, start on Next action, the completed work is done.

**Why `recall`?** `continue` collides with `claude --continue` and `resume` with `/resume` — both mean "reload an old transcript," the opposite of a deliberate wipe. `restore` is the VM pair for snapshot; `recall` is the memory pair. Snapshot writes memory out, recall brings it back.

**Why user-invoked only?** Both skills set `disable-model-invocation: true`. Neither belongs in the model-facing skill index costing tokens every turn, and Claude should never decide on its own to snapshot, or to "recall."

## Deliberately not done

- **No auto-snapshot on `/clear`.** A clear without a snapshot should stay empty; auto-snapshotting would freeze a session you meant to abandon.
- **No hook on `/compact`.** Compact stays your mid-task trim. Snapshot is the phase cut.
- **Nothing in `CLAUDE.md` or memory.** Those persist. This is meant to be ephemeral.

## License

MIT
