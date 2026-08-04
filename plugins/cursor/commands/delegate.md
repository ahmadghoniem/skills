---
description: Delegate a coding task to the Cursor CLI agent (Composer by default).
argument-hint: '[--background] [--wait] [--fresh] [--resume[=chat-id]] [--model <id>] [--cloud] [--no-force] [--no-git-check] [--timeout <sec>] <task...>'
allowed-tools: Bash(node:*), AskUserQuestion, WebFetch(domain:cursor.com)
---

`$ARGUMENTS` is the raw text the user typed after `/cursor:delegate`.

## Three entrypoints, one job registry

`/cursor:delegate` starts a job; `/cursor:status [job-id]` and `/cursor:result [job-id]` inspect it afterwards. All three share the same file-backed job record (`~/.ccd/jobs/<repo-hash>/<id>.json`), keyed by the **Cursor job id** this command prints — not any wrapper id a background-execution mechanism might report. Copy that id verbatim for follow-up commands.

Key flags, all forwarded through `$ARGUMENTS` verbatim:

- **`--wait` / `--background`** — `--wait` (default) blocks until the run finishes and prints the full result inline. `--background` detaches immediately and prints the job id right away; poll it with `/cursor:status <id>` or fetch the final write-up with `/cursor:result <id>` once it's done. `--wait` always wins if both are passed.
- **`--timeout <sec>`** — kills the run (SIGTERM, then SIGKILL after 5s) if it hasn't finished by then. Default 1800s (30 min). A killed run is still recorded as `failed` with a note — never silently dropped.
- **`--no-git-check`** — the only supported spelling. By default `/cursor:delegate` refuses to run outside a git repository; pass this to override (e.g. scratch directories).

## What you must do

1. **Check for an explicit `--model` in `$ARGUMENTS`.** If present, skip straight to step 3 with `$ARGUMENTS` unchanged — an explicit `--model` always bypasses model selection.

2. **Otherwise, resolve a model first:**
   a. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --print-models` to get the account's actual live model ids. Never rely on memorized model names — they go stale within weeks.
   b. For each id that isn't already covered by a cached note, do **one** `WebFetch` restricted to `cursor.com` (e.g. the models/pricing page) to learn its rough capability tier and strengths, then cache it immediately:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --note-model <id> --tier <tier> --note "<one-line strength summary>" --source <cursor.com url>`
   If you're offline or the fetch fails, **do not block** — hedge honestly ("no cached info on `<id>`, treating as unknown-tier") and move on. A missing note is never a reason to stop the delegation.
   c. Classify the task from its description and, using whatever tiers/notes you have (freshly fetched or cached), call `AskUserQuestion` recommending the best-fit model **first** with a one-line rationale, followed by 1-2 sensible alternatives each with a short why-not. Default toward the fastest model that plausibly fits — `fast`/`composer` (`composer-2.5-fast`) for small well-scoped changes — and only recommend escalating for genuinely large/cross-cutting/subtle tasks.
   d. Take the user's answer (or your recommendation if they have no preference) and append `--model <id>` to `$ARGUMENTS`.

   `/cursor:setup -- --refresh-models` clears the notes cache (e.g. after a Cursor lineup change) so the next delegation re-learns tiers from scratch.

3. **Run the job** with the `Bash` tool: `node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- <the resolved arguments>`. Do not paraphrase or reconstruct its output.

4. **Render the result verbatim.** If the job ran in the foreground, present the status, files touched, and summary sections as a compact Markdown block. If the job was started in the background, show the returned job id and the `/cursor:status` hint. Do not paraphrase Cursor's summary.
