---
description: Delegate a coding task to the Cursor CLI agent (Composer by default).
argument-hint: '[--background] [--wait] [--fresh] [--resume[=chat-id]] [--model <id>] [--cloud] [--no-force] [--no-git-check] [--timeout <sec>] [--prompt-file <path|->] <task...>'
allowed-tools: Bash(node:*), AskUserQuestion
---

`$ARGUMENTS` is the raw text the user typed after `/cursor:delegate`.

## Three entrypoints, one job registry

`/cursor:delegate` starts a job; `/cursor:result [job-id]` inspects it afterwards. Both share the same file-backed job record (`~/.ccd/jobs/<repo-hash>/<id>.json`), keyed by the **Cursor job id** this command prints — not any wrapper id a background-execution mechanism might report. Copy that id verbatim for follow-up commands.

Key flags, all forwarded through `$ARGUMENTS` verbatim:

- **`--wait` / `--background`** — `--wait` (default) blocks until the run finishes and prints the full result inline. `--background` detaches immediately and prints the job id right away; fetch the final write-up with `/cursor:result <id>` once it's done. `--wait` always wins if both are passed.
- **`--timeout <sec>`** — kills the run (SIGTERM, then SIGKILL after 5s) if it hasn't finished by then. Default 1800s (30 min). A killed run is still recorded as `failed` with a note — never silently dropped.
- **`--no-git-check`** — the only supported spelling. By default `/cursor:delegate` refuses to run outside a git repository; pass this to override (e.g. scratch directories).
- **`--prompt-file <path>`** (or `--prompt-file -` for stdin) — read the task from a file instead of the command line. Use it for long, multi-line, or quote-heavy specs that would be mangled as shell arguments; it is mutually exclusive with an inline task. For a spec already living in the repo, prefer an `@path` reference in the inline task instead — that lets cursor-agent open the file itself.
- **`--arg-string <blob>`** — pass one unsplit argument blob (the raw `$ARGUMENTS` string that has never been through a shell). The plugin splits it with quote handling. Use this when the whole invocation is a single string; do **not** join already-split argv back into a string.

## What you must do

1. **Check for an explicit `--model` in `$ARGUMENTS`.** If present, skip straight to step 3 with `$ARGUMENTS` unchanged — an explicit `--model` always bypasses model selection.

2. **Otherwise, resolve a model in two questions.**

   Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --print-models` for the account's live ids. It prints them in two groups — **included in your plan** (Cursor's own models) and **metered per token** (third-party) — and marks which ones have a `-fast` variant. Never recommend a model id that isn't in that output.

   **Question 1 — which model.** Call `AskUserQuestion` with your recommendation first, in this order of preference:
   - **Composer** (`composer-2.5`) — included in the plan, fastest. The default for small, well-scoped changes.
   - **Cursor Grok** (`cursor-grok-4.5-medium`, or `-high` for harder work) — also included in the plan, stronger reasoning. Prefer the newest Cursor Grok in the list.
   - **A third-party model** — only when the task genuinely needs it. Say plainly that it is metered per token rather than included.

   **Question 2 — fast variant.** Ask **only if** the chosen model's `--print-models` entry showed a fast variant. Many models have none, and then this question must be skipped entirely. State in the option that fast runs the same model on faster hardware for roughly **2x the usage cost**, so on an included model it burns the plan's pool about twice as quickly. If the user picks fast, use the `-fast` id.

3. **Run the job** with the `Bash` tool, putting flags **before** the task and keeping the task as one quoted argument:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- --model <resolved-id> "<task>"
   ```

   Never split the task across multiple arguments and never place a flag after it. When you must forward the raw `$ARGUMENTS` blob unchanged (one unsplit string, quotes still in it), pass it as `--arg-string`:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- --arg-string "$ARGUMENTS"
   ```

   Do not paraphrase or reconstruct the command's output.

4. **Render the result verbatim.** If the job ran in the foreground, present the status, files touched, and summary sections as a compact Markdown block. If the job was started in the background, show the returned job id and the `/cursor:result` hint. Do not paraphrase Cursor's summary.
