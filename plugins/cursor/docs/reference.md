# Reference

Deep-dive material that used to live in the README. Start there for the overview; come here for
the full detail — every flag, every worked example, every failure mode we've hit.

## Why this plugin

Short answer: **Composer is genuinely good at most day-to-day coding work** — and a pile of
terminal windows is not how anyone wants to drive it. The flow that keeps working is simple:
**Claude makes the plan, Composer executes it, Claude reviews the diff.** Two tools, each doing
what it is best at.

"Why not do the whole thing inside Cursor, then?" Claude Code has a certain magic, particularly
around planning. It is not purely about the underlying model — it is the whole rig (long-context
sessions, subagents, the TUI, the way tools compose) that, in practice, only really clicks inside
Claude Code.

Cursor CLI has its own plan mode and it is fine, but execution is where Cursor really shines: file
edits, applying diffs, crunching through a well-scoped task list in force mode. Cursor 2 and the
Composer models are heavily tuned for exactly that CLI use-case.

So: Claude plans, Cursor writes, Claude reviews, repeat.

## The two-phase loop

This plugin is built around one pattern: **Claude plans and reviews, Cursor writes code.** Treat
them as two separate roles, not one pipeline:

1. **Plan / spec** — Claude Code scopes the change, picks the slice to delegate, and drafts
   acceptance criteria. This is where architectural judgment happens.
2. **Execute** — `/cursor:delegate` (or the `cursor-runner` subagent) hands that spec to Cursor.
   Cursor writes files under `--force`, fast.
3. **Review** — Claude reads the diff Cursor produced. This is where correctness and style are
   checked.
4. **Iterate** — `/cursor:resume "fix X"` for the same thread, or `/cursor:delegate --fresh` for a
   new slice.

The plugin intentionally does not try to collapse these phases into one. Cursor is fast but
context-starved; Claude has the whole session context but is slower per edit. Keeping them in
separate phases is the whole point.

### Writing good prompts for Cursor

A good `/cursor:delegate` prompt has five sections:

1. **Goal** — one sentence.
2. **Repo context** — stack, and a pointer to whatever conventions file applies (`AGENTS.md`,
   `.cursor/rules`, `CLAUDE.md`).
3. **Acceptance criteria** — 1–5 verifiable bullets.
4. **Files to touch** — explicit list when you can predict it.
5. **How to verify** — the exact commands (`npm test`, `task typecheck`, …) that prove the task is
   done.

The `cursor-runner` subagent applies this template automatically. When you write
`/cursor:delegate` by hand, aim for the same structure in the task string — it is the single
biggest lever on Cursor's output quality.

### Chunking

`cursor-agent --force` will YOLO through whatever you give it. Keep slices small: **≤ 5 steps,
≤ 10 files, ≤ 2 architectural layers per `/cursor:delegate` call.** If the plan is bigger, split
it — one slice per call — and let Claude review between slices.

### Language and target-repo conventions

The plugin codebase is English, but it does not impose a language policy on **your** repo. When
the `cursor-runner` subagent prepares a prompt, it reads the target repo's `AGENTS.md` /
`.cursor/rules` / existing code and tells Cursor to match that style — whether that means Czech
commits, German UI strings, or anything else. Do not put "write everything in English" in your own
prompts unless that is actually your repo's convention.

## Delegate flags

Full flag table for `/cursor:delegate <task...>` (the README covers the core subset):

| Flag | Default | Effect |
| ---- | ------- | ------ |
| `--model <id>` | recommended automatically (or `$CCD_DEFAULT_MODEL`) | Aliases → real Cursor ids: `composer`/`fast` → `composer-2.5-fast`, `composer-full` → `composer-2.5`, `sonnet` → `claude-4.6-sonnet-medium`, `opus` → `claude-opus-4-7-high`, `gpt`/`codex` → `gpt-5.3-codex`, `grok` → `grok-4.3`, `gemini` → `gemini-3.1-pro`, `auto` → `auto`. Unknown or retired ids are forwarded as-is. Omit this flag entirely to get task-aware model selection instead of a fixed default — see the README's [Model selection](../README.md#model-selection) section. |
| `--background` | off | Detach; the command returns a job id immediately. |
| `--wait` | on (if not `--background`) | Block until finished. |
| `--fresh` | off | Start a brand-new Cursor session (no resume). |
| `--resume[=<chat-id>]` | off | Resume a prior chat. With no id, resume the latest for this repo. |
| `--no-force` | `--force` is ON | Disable auto-approve (paranoid mode). |
| `--cloud` | off | Pass `-c` to cursor-agent. |
| `--timeout <sec>` | `1800` | Kill the job if it exceeds this. |
| `--no-git-check` | off | Allow running outside a git repo. |
| `--refresh-models` | off | Force a fresh `cursor-agent --list-models` fetch and re-learn any unfamiliar models instead of trusting `~/.ccd/model-notes.json`. |

Examples:

```
/cursor:delegate add a dark-mode toggle to the settings page
/cursor:delegate --model composer "write jest tests for utils/date.ts"
/cursor:delegate --background --model auto "migrate user repository to Doctrine 3"
/cursor:delegate --resume "continue with the failing edge case"
/cursor:delegate --refresh-models "try the newest Grok model"
```

## Typical flows

**Fast parallel task.** You're in Claude Code. You want Cursor to handle something small while
you keep working.

```
/cursor:delegate --background "write jest tests for src/utils/date.ts"
# keep talking to Claude
/cursor:result
```

**Tight loop.** Delegate in the foreground, let Claude review, then iterate.

```
/cursor:delegate "extract the retry logic from apiClient.ts into a hook"
# Claude reads the diff, suggests a fix
/cursor:resume "also add a unit test for the 429 path"
```

**Escalation.** Start small, upgrade if Cursor stalls.

```
/cursor:delegate --model composer "<task>"
# composer gave up — retry with opus from scratch
/cursor:delegate --model opus --fresh "<same task>"
```

**Resume vs fresh.** Use `--resume` (default) when the new task is the same thread of work. Use
`--fresh` when the topic changed, or when the previous run went off the rails and resuming would
just carry the confusion forward.

## How I actually use this (the recipe I run every day)

The two-phase loop above is the concept; here is the concrete workflow that falls out of it in
practice:

1. **Plan in Claude Code and write a task file.** Describe what you want; ask Claude to draft a
   _task spec_ — a markdown file with **goal**, **acceptance criteria**, **files to touch**, and
   **how to verify** (the same five sections the `cursor-runner` subagent enforces). Save it under
   `tasks/<slug>.md` in the repo.
2. **Hand the file to Cursor.** Run `/cursor:delegate @tasks/<slug>.md implement this`. The
   `@path` shorthand inlines the file contents into the prompt, so Cursor gets the full spec
   without Claude having to re-type it. Composer executes — it is genuinely fast, and a precisely
   defined task is usually a one-shot job.
3. **Back in Claude Code: review the diff.** Approve, or iterate with `/cursor:resume "fix X"` on
   the same thread, or escalate with `/cursor:delegate --model opus --fresh <same task file>` if
   Composer stalled.
4. **Keep the task files around.** `tasks/` becomes a little log of what the repo's delegated
   changes looked like. Handy when you want to re-delegate a similar slice — just copy an old
   file, tweak the bullets.

Why this works: Claude's tokens go into **planning and reviewing**, where thinking matters;
Cursor's Composer handles **the actual typing**, where it is cheaper and faster. The task file is
the contract between the two phases — if it is sloppy, no model will save you.

If you want Claude to do the whole thing automatically — draft the task file AND hand it off —
that is what the `cursor-runner` subagent is for. Ask it to either "draft a task file for X" (it
stops there) or "implement X via Cursor" (it drafts, hands off, and reports the diff).

### Bonus: plan mode → `/cursor:from-plan` → delegate

If you already used Claude Code's **plan mode** for a task (the `/plan …` flow that drops a plan
file under `~/.claude/plans/<slug>.md` after you approve it), you do not need to re-type anything.
Run `/cursor:from-plan` and the plugin will:

1. Pick the newest plan under `~/.claude/plans/` (or the one matching a name fragment you pass).
2. Extract the useful sections (Context → Repo context, Approach → Acceptance criteria, File list
   → Files to touch, Verification → How to verify), drop the dev-only bits (Effort, Risks, Scope
   exclusions), and add the standard guardrail block.
3. Write the result to `tasks/<YYYYMMDD-HHmm>-<slug>.md` in the current repo and print the exact
   `/cursor:delegate @tasks/…` command for you to run.

So the full loop is:

```
/plan add a dark-mode toggle to the settings page
# Claude proposes a plan; you approve inside plan mode.
/cursor:from-plan --delegate --model opus
# Plan gets turned into a task file and handed off to Cursor in one step.
# Back in Claude Code: review the diff, /cursor:resume "fix X" if needed.
```

## FAQ

**Does it need a special Node version?** Yes — ≥ 18.18. The CI matrix tests 18.18, 20, and 22 on
Windows and Linux.

**Does it use my existing Cursor auth?** Yes. The plugin shells out to your already-installed
`cursor-agent`, which uses whatever session `cursor-agent login` set up (or `CURSOR_API_KEY` if
you prefer).

**Does it upload my code anywhere?** No — the plugin itself runs locally. `cursor-agent` of course
sends your prompts to Cursor's backend; that is Cursor's normal behaviour, not something this
plugin changes.

**What does `--force` do?** It is Cursor's auto-approve (aka `--yolo`). With it on, Cursor writes
files without asking each time. This is necessary for non-interactive use but means Cursor can
touch your working tree freely. Use `--no-force` if you want to test against an interactive flow —
but note that most headless invocations will hang waiting for approval, so `--no-force` is really
only useful for debugging.

**How does model selection work when I don't pass `--model`?** The plugin reads the live model
list (`cursor-agent --list-models`), recommends the best fit for the task, and shows a short
rationale. If it encounters a model it has not seen before, it looks it up once on cursor.com and
caches what it learns in `~/.ccd/model-notes.json` so future runs are instant. Force a refresh with
`--refresh-models`.

**The model list doesn't match what I see in Cursor.** Run `/cursor:setup --print-models` — that
shells out to `cursor-agent --list-models` and shows exactly what your account supports. The alias
table in the plugin is a convenience; Cursor's actual model IDs drift over time.

**`cursor-agent` hangs after finishing a task.** Known quirk of the print-mode CLI. The plugin has
a 5-second watchdog that SIGTERMs the process after a `result` event if it hasn't self-exited,
then SIGKILLs 5 seconds later.

## Troubleshooting

Things that bit users (and us) during development, with the exact fix each time.

### `Unknown command: /cursor:setup`

You skipped `/reload-plugins`. Claude Code only picks up newly-installed plugin commands after a
reload — `/plugin install` alone is not enough. Run `/reload-plugins` and the commands appear.

### `Shell command failed for pattern ... no matches found: review?`

Zsh globbing on `?` or `*` in your prompt. This should not happen in `v0.2.0+` because every
command wrapper quotes `"$ARGUMENTS"`. If you see it, your plugin is outdated — reinstall:
`/plugin marketplace remove claude-cursor-delegate && /plugin marketplace add ahmadghoniem/claude-cursor-delegate && /plugin install cursor@claude-cursor-delegate && /reload-plugins`.

### `Error: Cannot find module '.../dist/<cmd>.js'` or `'.../scripts/<cmd>.mjs'`

Stale plugin cache from an older version. Same fix as above: remove marketplace, re-add,
re-install, reload.

### `Shell command permission check failed for pattern "!node ..."`

First-time Bash permission prompt. Approve `node` for this session (Claude Code asks once per
session; the approval covers all plugin commands since all of them invoke `node`). If you denied
it accidentally, `/permissions` lets you review/change.

### `/cursor:from-plan` says "no plan files found"

Claude Code only writes plan files when you explicitly enter plan mode and then exit it with
approval. If you never did that, there is nothing to convert. Enter plan mode (`/plan ...`) first;
run `/cursor:from-plan --list` afterwards to confirm the file is there.

### `cursor-agent` hangs mid-run

Usually Cursor's backend, not us. The plugin has a default 30-minute timeout (`--timeout 1800`).
For long tasks, bump it with `--timeout 3600`. For stuck jobs, `/cursor:cancel <id>` — SIGTERM with
a 5 s grace window, then SIGKILL.

### `/cursor:delegate` prints `Error: current directory is not a git repository`

Safety check: by default the plugin refuses to run outside a git repo so Cursor cannot modify an
unversioned tree. Pass `--no-git-check` if you know what you are doing.

### Logs and raw output

Every job writes its full `cursor-agent` NDJSON stream to
`~/.ccd/jobs/<repo-hash>/logs/<job-id>.ndjson`. When reporting bugs, include the first ~50 lines of
the relevant log (after scrubbing anything sensitive).
