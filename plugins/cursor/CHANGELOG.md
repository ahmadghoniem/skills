# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.10.0 — argv stops mangling paths, and failed commands get reported

Four fixes backported from the sibling `claude-grok-delegate` plugin, which was forked from this
codebase and hit them in real use.

### Fixed

- **`collapseCommandArgv` tore apart any argument containing a space.** It joined argv with spaces
  and re-split on whitespace — lossy, because a real shell has already performed quote removal by
  then. `--prompt-file "/c/Users/Ada Lovelace/spec.md"` arrives as one correct argv element; the
  join made its internal spaces indistinguishable from separators, and the re-split produced
  `/c/Users/Ada` + `Lovelace/spec.md`. The fragment landed in `positional`, so dispatch died on
  "pass the task either on the command line or via --prompt-file, not both" — a message describing
  something that never happened. Every home-directory path with a space in it hit this, and
  `cursor-runner` is explicitly instructed to pass plans from `~/.claude/plans/` this way.

  The same join also flattened multi-line briefs: newlines and runs of whitespace collapsed to
  single spaces, and embedded quotes were stripped, so a structured prompt reached cursor-agent as
  one long line.

  Argv is now returned untouched unless the new `--arg-string <blob>` marker is present, which is
  the only case that genuinely has never been through a shell (Claude Code hands `"$ARGUMENTS"`
  over as a single string). No inference from token count — the caller says which it is.

  Worth noting this shipped past a 108-test suite: the existing coverage only ever fed
  `collapseCommandArgv` single-string input, the one shape where the old code was correct.

- **`/cursor:result --all` printed a single job.** `--all` is a modifier on `--list` that drops the
  10-job cap, but it was only read inside the `--list` branch. Used alone it fell through to
  "print the most recent job", which renders similarly enough to go unnoticed — no error, just the
  wrong output. `--all` now implies `--list`.

- **The same file could appear twice in "Files touched"**, once repo-relative and once absolute,
  making a one-file change look like two. Paths under the repo root are now rebased to relative and
  deduplicated; paths genuinely outside the repo stay absolute, which is what a reviewer needs to
  notice.

### Added

- **Non-zero command exits are now reported.** cursor-agent's stream carries an exit code for every
  shell command it runs, at `tool_call.shellToolCall.result.{success|failure}.exitCode`. A new
  **⚠ Commands that exited non-zero** section lists them with their output, in both the foreground
  write-up and `/cursor:result`.

  It is reported, never fatal. A non-zero exit is routinely intentional — a `grep` that matches
  nothing, a deliberately red test in a TDD cycle, a `command -v` probe — so job status still comes
  from cursor-agent's own result event alone. The point is that a run can read as a success in
  prose while several commands quietly failed underneath it.

  Rendering moved to `scripts/lib/render.mjs` and is shared by `delegate.mjs` and `result.mjs`, so
  the write-up you see when a job finishes and the one you fetch later cannot drift.

- **`--arg-string <blob>`** — pass one unsplit argument string for the plugin to split. Documented
  in `/cursor:delegate`.

## 0.9.0 — `/cursor:result --list`, and a lighter cursor-runner

### Added

- **`/cursor:result --list`** — the job listing 0.8.0 removed with `/cursor:status`, restored
  without a new always-on entry. Prints the last 10 tracked jobs (`--all` for every one) as a
  Markdown table, running ones included, so it doubles as the way to recover the id of a
  `--background` job. The renderer moved to `scripts/lib/jobtable.mjs` and is shared with
  `status.mjs`, so the two listings cannot drift apart. `jobNotFoundMessage` now points here
  rather than at `/cursor:sessions`, which lists Cursor's *chat* sessions and never was the
  right recovery path for a *job* id.

### Changed

- **Chunking is a judgment call, not a refusal.** `cursor-runner` previously had to "refuse to
  delegate a single monolithic blob" whenever a task passed ~5 steps / ~10 files / 2 layers.
  Those thresholds are useful signals but poor rules — a coherent change can trip one and still
  be right to send whole, and an agent that hard-refuses just makes the caller fight it. They are
  now stated as signals to weigh, with splitting preferred when several hold at once or the steps
  are only loosely related, and a matching guardrail: don't unilaterally decide a task is too big
  — raise the concern and send it.
- **Dropped the target-repo language rule** ("if the repo's comments are Czech, Composer must
  match"). "Match the existing style of surrounding files" already covers it without the
  language-specific framing.
- **`cursor-runner`'s description trimmed again**, to just what it does. The routing guardrail
  ("not for code review, design decisions, or large refactors") is gone at the maintainer's
  request; routing is decided by the caller rather than defended in always-on text.

## 0.8.0 — cut always-on context cost (breaking)

Every skill, command, and agent this plugin ships pays a token cost in **every**
Claude Code session, before anything is invoked — only `name` + `description`
load at startup; bodies and `argument-hint` load on invocation and are free.
Measured at 0.7.0 the plugin cost ~412 always-on tokens, the largest single
contributor in a typical config. This release cuts that to ~270 (~35%) without
losing a workflow.

### Removed

- **`/cursor:status`.** It carried `disable-model-invocation: true`, so Claude
  could never call it — it existed purely to be typed by hand. In an
  agent-driven workflow that is ~30 tokens per session for a command that never
  fires. `scripts/status.mjs` is retained and still works when run directly;
  `/cursor:result` covers finished jobs and `/cursor:sessions` lists tracked
  ones. **If you poll `--background` jobs by hand, this is the one to notice** —
  run the script by path instead.
- **The `composer-prompting` skill**, folded back into `agents/cursor-runner.md`.
  It was extracted in 0.4.0 (ported from `openai/codex-plugin-cc`, mirroring its
  `gpt-5-4-prompting` skill) so the agent would not restate the mechanics inline.
  That optimised the agent's *body* — which is on-invoke and already free — while
  creating a second always-on entry costing ~60 tokens in every session, with
  `user-invocable: false` and exactly one consumer. The guidance is unchanged;
  it now lives inline under "1. Shape the prompt", so it is paid only when
  `cursor-runner` actually runs.

### Changed

- **`cursor-runner`'s description trimmed 322 → 129 chars** (~130 → ~80 tokens).
  A description exists to let Claude decide whether to route here, so the
  negative guardrail ("not for code review, design decisions, or large
  refactors") is kept verbatim — dropping that is what causes mis-routing. The
  operational detail moved into the body, where it is free and available at the
  moment it is needed.
- **Dropped the stale `default model composer-2.5-fast` claim** from that
  description. 0.5.0 replaced the static default with task-aware model
  selection, but the description had continued to advertise it — a wrong fact
  sitting in every session's context.

## 0.7.0 — fix silent flag loss; pool-aware model selection

### Fixed

- **A `--` in the task text silently swallowed every flag after it.** `collapseCommandArgv` strips the slash-command's own `--` delimiter, but any *second* `--` — easily present in a task description — reached `parseArgv` and was honoured as a Unix end-of-flags marker. Everything after it, including `--model` and `--timeout`, became prompt text: the job ran on the default model, reported success, and nothing said the flags had been dropped. `parseArgv` now takes `honorDoubleDash`, and the slash-command path opts out. The `--` also survives into the prompt now instead of being deleted from the task.
- **The result block never said which model ran.** The model was printed only on the *start* line, and only as the *requested* value — so an `auto` run, or a `--model` that never arrived, was invisible in the output. The foreground result block now echoes `**Model:**` with the model that actually ran (`/cursor:status` and `/cursor:result` already did).

### Changed

- **Model selection now follows the plan's two usage pools.** `/cursor:setup --print-models` splits the live list into **included in your plan** (Cursor's own models — Composer, Cursor Grok) and **metered per token** (third-party), and marks which ids have a `-fast` sibling. `/cursor:delegate` recommends from the included group first and only suggests a metered model when the task warrants it. The split comes from Cursor's own id namespacing (`composer*` / `cursor-*`), so new releases classify correctly without a code change.
- **A second question offers the `-fast` variant — only when one exists.** Roughly half the lineup has no fast id (`claude-sonnet-5-*`, `gemini-*`, `kimi-*`, …), and the question is skipped entirely for those. Fast runs the same model on quicker hardware at about 2x the usage cost.
- **Flags now documented before the task**, as a single quoted argument, in both `commands/delegate.md` and `agents/cursor-runner.md`.

### Removed

- **The model-notes cache (`lib/model-notes.mjs`, `--note-model`, `--refresh-models`, `~/.ccd/model-notes.json`).** It existed so the agent could web-fetch cursor.com for each unfamiliar model id and cache a guessed capability tier before every delegation — slow, failure-prone, and guessing at exactly the fact the grouped model list now reports directly. `/cursor:delegate` no longer needs `WebFetch` at all.

## 0.6.0 — file/stdin task input; remove `/cursor:from-plan`

### Added

- **`--prompt-file <path>` / `--prompt-file -` (stdin) for `/cursor:delegate`.** Read the task from a file or piped stdin instead of the command line — for long, multi-line, or quote-heavy specs that shell-argument quoting would otherwise mangle. Mutually exclusive with an inline task; empty or missing input fails with a clear error. Routes through the same `CCD_PROMPT` path the background worker already uses, so background jobs get the same robustness for free.

### Removed

- **`/cursor:from-plan`.** It only rewrote a `~/.claude/plans/<slug>.md` file into a `tasks/<file>.md` and printed a delegate command — a file-shuffling step Claude does directly, and one the new `--prompt-file` now covers for out-of-repo plans. Delegate a plan with `/cursor:delegate --prompt-file ~/.claude/plans/<slug>.md`; for an in-repo spec, reference it inline with `@path`. The `lib/plan.mjs` parser and its tests were removed with the command.
- **Orphaned review-context helpers.** The Cursor review commands (`/cursor:review`, `/cursor:adversarial-review`; see 0.4.0) were dropped earlier, but their `lib/git.mjs` support code (`collectReviewContext`, `currentBranch`, `detectDefaultBranch`, `workingTreeStatus`, and their private helpers) and an unused `maskSecrets()` in `lib/cursor.mjs` were left behind — ~250 lines with no callers. Removed; `git.mjs` now exports only `isGitRepo` / `repoRoot` (and gains its first tests).

## 0.5.0 — task-aware model selection + internal rename to `ccd` (breaking)

### Added

- **Task-aware model selection.** `/cursor:delegate` without `--model` no longer falls back to a static default — it reads the live model list, recommends the best fit for the task at hand, and shows a short rationale before the job runs. Passing `--model <id>` bypasses this entirely. Any Cursor model id passes through untouched, so brand-new models (e.g. Grok 4.5 and later) work with no code change.
- **Self-updating model-notes cache.** Unfamiliar models are looked up once on cursor.com and cached in `~/.ccd/model-notes.json`, so the plugin's model knowledge grows over time instead of going stale. `--refresh-models` forces a re-fetch and re-learns anything unfamiliar.

### Fixed

- **`/cursor:status` and `/cursor:result` now accept the id `/cursor:delegate --background` actually prints.** The launched job id was being retrieved inconsistently, so looking it up right after a background delegate could report "not found." Both commands now resolve the same id the launch step returns.
- **`filesTouched` is now populated** on job records instead of staying empty — `/cursor:status <job-id>` reflects what Cursor actually changed.
- **Background jobs now write a completion sentinel**, closing a race where a background job could be read as still-running right after it finished.

### Changed

- **BREAKING: internal namespace renamed from `cursor-plugin-cc` to `ccd`.** The jobs-registry root moved from `~/.cursor-plugin-cc/` to `~/.ccd/`; the env vars are now `CCD_HOME` and `CCD_DEFAULT_MODEL` (replacing `CURSOR_PLUGIN_CC_HOME` and `CURSOR_PLUGIN_CC_DEFAULT_MODEL`). The old env vars and directory are **no longer read** — there is no fallback. If you had `CURSOR_PLUGIN_CC_*` set or jobs under `~/.cursor-plugin-cc/`, update your shell config; old job history is not migrated automatically. A future per-repo config file will be `.ccd.json`.
- **Platform scope is now Windows + Linux.** macOS support is dropped; the CI matrix and documentation no longer claim it.
- **Model alias table slimmed** to the ids that still matter day-to-day now that task-aware selection handles the rest of the picture.

### Removed

- **`/cursor:browser`** and its browser page-verification feature (the `chrome-devtools` MCP integration) have been removed.

### Deferred (backlog, not in this release)

- Self-verify against acceptance criteria after a job finishes — likely stays a main-thread review convention rather than plugin machinery.

## 0.4.0 — /cursor:adversarial-review + estimate-first reviews + composer-prompting skill

Ported from upstream [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) (whose `/codex:adversarial-review`, estimate-first review flow, and `gpt-5-4-prompting` skill this release mirrors), adapted to the Cursor CLI.

### Added

- **`/cursor:adversarial-review`** — a first-class steerable review command that challenges the chosen implementation and design (assumptions, tradeoffs, failure modes, whether a different approach would be simpler or safer), not just implementation defects. It reuses the existing review runtime (`scripts/review.mjs --adversarial`), so it supports `--base <ref>`, `--scope`, `--model`, `--wait`/`--background`, and free-form focus text, and is tracked as a normal job (`/cursor:status`, `/cursor:result`, `/cursor:cancel` all apply). Promotes what used to be only the `--adversarial` flag on `/cursor:review` into a discoverable command with sharper framing.
- **`composer-prompting` skill** — the Cursor/Composer prompt-shaping guidance (repo grounding, the five-section prompt anatomy + guardrails, chunking heuristics, model selection, resume-vs-fresh) now lives in `plugins/cursor/skills/composer-prompting/SKILL.md`. The `cursor-runner` subagent references it via a new `skills:` frontmatter entry instead of restating the mechanics inline, and the main thread can consult it when hand-crafting `/cursor:delegate` prompts. Mirrors codex's internal `gpt-5-4-prompting` skill.

### Changed

- **`/cursor:review` and `/cursor:adversarial-review` estimate the diff before running.** When neither `--wait` nor `--background` is passed, the command inspects `git status` / `git diff --shortstat` to gauge review size, then asks once (via `AskUserQuestion`) whether to wait or run in the background — recommending background for anything beyond a tiny 1–2 file change. Explicit `--wait` / `--background` skip the question. The commands moved from an auto-executing one-liner wrapper to a model-orchestrated flow; their `allowed-tools` now include `Bash(git:*)` and `AskUserQuestion` for the estimate step. Background runs still use the plugin's own detached worker (the script returns a job id immediately), not a Claude background task.
- **`cursor-runner` subagent slimmed** — the prompt-anatomy, chunking, model, and resume/fresh sections were extracted into the `composer-prompting` skill; the agent now points at the skill and keeps only its operational spine (ground → invoke `/cursor:delegate` → return verbatim) and guardrails.

## 0.3.2 — clearer "job not found" hint

### Fixed

- **`/cursor:status`, `/cursor:result`, `/cursor:cancel` now explain a missing job id** (#7). When `/cursor:delegate` runs as a Claude Code background command, Claude Code surfaces _its own_ wrapper id (`Command running in background with ID: …`), not the Cursor job id — so `/cursor:status <that-id>` always missed with a bare `No job … found`. The three commands now append a hint pointing out that a Claude Code background id is not the Cursor job id and that `/cursor:status` with no arguments lists the tracked jobs so the real id can be copied. New shared `lib/hints.mjs#jobNotFoundMessage`.

## 0.3.1 — model alias refresh (Composer 2.5 + Grok 4.3)

### Fixed

- **Model aliases updated for Composer 2.5.** Cursor retired the Composer 2.x ids — `cursor-agent --list-models` now lists only `composer-2.5` and `composer-2.5-fast` (verified on macOS, 2026-06-10). The `composer`, `composer-fast`, and `fast` shortcuts now resolve to `composer-2.5-fast` (was the dead `composer-2-fast`), and `composer-full` resolves to `composer-2.5` (was `composer-2`). The retired `composer-2` / `composer-2-fast` ids are kept as identity passthroughs so users on older `cursor-agent` builds aren't broken. README, the `cursor-runner` agent guidance, command/package descriptions, and tests updated to match. (#8)
- **`cursor-runner` agent invocation corrected.** Step 6 told the subagent to run `node_modules/.bin/tsx …/plugins/cursor/scripts/delegate.ts` — stale from before the zero-deps `.mjs` rewrite: `tsx` is not a dependency, there is no `.ts` file, and the path double-counted `plugins/cursor`. It now matches the working slash command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- …`. The `/cursor:delegate` slash command was already correct; only the subagent's documented call was broken. (#10)
- **`grok` alias retargeted to Grok 4.3.** `grok-4-20` and `grok-4-20-thinking` are also retired — `cursor-agent --list-models` now lists `grok-4.3` and `grok-build-0.1` (verified 2026-06-11). The `grok` shortcut resolves to `grok-4.3`, a new `grok-build` shortcut resolves to `grok-build-0.1`, and the `grok-thinking` alias is removed (no live thinking variant; the retired `grok-4-20` id still forwards as-is for older builds). README table and tests updated.

## 0.3.0 — /cursor:review + codebase hardening

### Added

- **`/cursor:review`** — read-only code review of your git diff by a Cursor model, modelled on `openai/codex-plugin-cc`'s `/codex:review`. The plugin collects the diff itself (working tree, or branch vs a `--base <ref>`), embeds it in a strict review-only prompt, runs `cursor-agent` over it, and returns the findings (Blocking / Should-fix / Nits + verdict) verbatim. Supports `--scope auto|working-tree|branch`, `--adversarial` (challenge the design), `--model`, `--background`/`--wait`, `--timeout`, and free-form focus text. Tracked as a normal job, so `/cursor:status`, `/cursor:result`, and `/cursor:cancel` apply. A post-flight check marks the job `failed` if the run touches the working tree, so a review can never silently become an edit. New `collectReviewContext` helpers in `scripts/lib/git.mjs`.

### Fixed

A full multi-agent review of the codebase (dogfooding `/cursor:review`) surfaced a batch of robustness issues, now fixed:

- **`delegate.mjs`** — a numeric `--resume=<id>` no longer crashes with `resume.trim is not a function` (the parser auto-cast it to a number). `--wait` is now a real toggle (forces the foreground even with `--background`). The background worker receives the prompt verbatim via env instead of re-collapsing it (which mangled quotes/backslashes), and its capture logs now land in the correct `jobs/<repo-hash>/` dir. A timed-out/watchdog-killed run is reported as `failed` with a note.
- **`cursor.mjs`** — `runHeadless` no longer crashes the process when the child fails to spawn (missing/non-executable binary) or when the log stream errors (ENOSPC/EACCES); both are handled and the run degrades gracefully. The post-result kill watchdog arms at most once. `CURSOR_AGENT_BIN` is trimmed before use.
- **`git.mjs`** — review of a repo with no commits now diffs against the empty-tree object instead of silently showing nothing; the working-tree status is collected once on the common path.
- **`paths.mjs`** — `repoHash` canonicalises the path the same way whether or not it exists, so a repo maps to a single jobs dir (fixes the macOS `/tmp`→`/private/tmp` split and a possible throw).
- **`parse.mjs`** — text extraction now flattens Anthropic `content[]` arrays, so output is captured even when a run is killed before the final `result` event.
- **`plan.mjs`** — `resolvePlanPath` rejects directories (was crashing with EISDIR); `## ` headings inside fenced code blocks are no longer mistaken for section headings; specific section hints (e.g. "files to touch") now beat generic ones ("files") regardless of document order.
- **`jobs.mjs`** — `atomicWrite` cleans up its temp file on a failed rename; a cancelled job is not resurrected to `done`/`failed` by a finishing background worker.
- **`args.mjs`** — `--no-foo=value` keeps its explicit value; backslashes inside single quotes and a trailing lone backslash are preserved (POSIX); integers beyond `MAX_SAFE_INTEGER` stay strings instead of losing precision. New shared `parseTimeout` (a non-numeric `--timeout` no longer silently disables the watchdog), `collapseCommandArgv`, and `parseCommandArgv` helpers de-duplicate the per-command argv prologue.
- **`browser.mjs`** — drops the never-honored `--background` flag; the MCP-usage gate matches `chrome-devtools` specifically instead of any `mcp_*`; killed runs are flagged.
- **`status.mjs` / `sessions.mjs`** — Markdown table cells escape `|` and tolerate records missing `prompt`/`model` (one bad record no longer aborts the whole listing) via the new `lib/md.mjs` helper.
- **`result.mjs`** — coerces non-string `summary`/`prompt`/`model` from a corrupted record instead of throwing.
- **`setup.mjs`** — `--doctor`'s "all checks passed" no longer masks a real failure whose detail happens to contain "not set".
- **`cancel.mjs`** — distinguishes a real cancellation from a no-op on an already-finished job.
- **`id.mjs`** — keeps the full base64url alphabet (filesystem-safe) instead of stripping then zero-padding, which shortened ids and biased the final character.

## 0.2.2 — resume bug fix + safer default model

### Fixed

- **`/cursor:resume <prompt…>`** no longer eats the first prompt word as a chat-id. `--resume` was missing from the boolean-flag whitelist, so the argv parser greedily consumed the next positional token (`Cursor chat id: řekni — resume with cursor-agent --resume=řekni`). Declared `resume` as boolean in `delegate.mjs`; `--resume=<chat-id>` still works because the `=` form is parsed independently. Regression tests cover both shapes plus a multi-word non-ASCII prompt.

### Changed

- **Default model is now `auto`** (was `composer-2-fast`). Users without a paid Composer 2 seat can run the plugin out of the box; Cursor picks whatever model the account is entitled to. Power users can pin a default globally via the new `CURSOR_PLUGIN_CC_DEFAULT_MODEL` env var (accepts the same aliases as `--model`), or per-invocation via `--model <id>`.
- README install section moved up front; GitHub install marked as preferred, local checkout install moved below it for hacking on the plugin. Requirements list now lives under Install and no longer implies a paid subscription is mandatory.

## 0.2.1 — OSS ergonomics (docs-only)

### Added

- `AGENTS.md` at repo root — hard rules any AI agent (Claude Code, Cursor, Codex) must follow when editing this repo. Dogfoods the same pattern `cursor-runner` tells agents to read in target repos.
- `CONTRIBUTING.md` — dev setup, branch naming, commit-message conventions, step-by-step recipe for adding a new slash command, and the release flow.
- `SECURITY.md` — vulnerability reporting, the `--force`/`--trust` trade-offs the user should understand, and the zero-deps supply-chain stance.
- `.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_request.yml` — structured forms that capture Node / cursor-agent / plugin version, `/cursor:setup --doctor` output and job id up-front.
- `.github/PULL_REQUEST_TEMPLATE.md` — summary + test plan + zero-deps checklist.
- README: new **Troubleshooting** section covering the six failure modes that tripped us during development (reload-plugins, shell globbing, module-not-found, Bash permission, browser MCP not loaded, from-plan empty).

### Changed

- README "Contributing" shrunk to a pointer toward the new dedicated files so the homepage stays scannable.

## 0.2.0 — plan-mode bridge + zero-deps rewrite

### Added

- **`/cursor:from-plan`** — new command that turns a Claude Code plan file (`~/.claude/plans/<slug>.md`) into a Cursor-shaped task file under `tasks/<YYYYMMDD-HHmm>-<slug>.md` and optionally auto-invokes `/cursor:delegate` with it. Bridges Claude's plan mode directly into the Cursor execution flow. `--list` lists recent plans; `--delegate` / `--yes` skips the preview step.

### Changed

- Rewrote the plugin as **zero-dependency `.mjs`** (no TypeScript, no runtime packages). Sources under `scripts/` are what ships — Claude Code executes them directly after `/plugin install`, no build step, no cache-time `npm install`. Matches the `openai/codex-plugin-cc` shape. `execa`/`zod`/`nanoid`/`yargs-parser` are gone; replaced by `scripts/lib/run.mjs`, `scripts/lib/id.mjs`, `scripts/lib/args.mjs` and plain JSON handling.
- Slash-command bodies now invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/<cmd>.mjs"` (was `dist/<cmd>.js`).
- Robust entry-point detection (`lib/invoked.mjs`) — `realpathSync` on both sides, fixes a silent no-op when the plugin was executed through a symlinked path (e.g. macOS `/tmp → /private/tmp`).

### Planned

- Support additional browser-automation MCPs (next target: Mozilla [firefox-devtools-mcp](https://github.com/mozilla/firefox-devtools-mcp)). `/cursor:browser` will grow a `--mcp <name>` flag and autodiscover from `cursor-agent mcp list`.
- Repo-local `.cursor-plugin-cc.json` for per-project default model / timeout / MCP preference.
- `/cursor:task new "<slug>"`, `/cursor:diff [job-id]`, `/cursor:retry [job-id]` — quality-of-life commands.

## 0.1.0 — initial release

### Added

- `/cursor:delegate` — hand a coding task to `cursor-agent`, with background and resume support. Default model is `composer-2-fast` (Cursor's own current default, fastest Composer variant).
- `/cursor:browser <url> <what to verify>` — read-only browser verification via Cursor's `chrome-devtools` MCP. Pre-checks MCP availability, bakes in `--approve-mcps`, scripts the standard `list_pages → navigate → take_snapshot → interact → wait_for → console/network` flow.
- `/cursor:status` — list or inspect tracked jobs for the current repository.
- `/cursor:result` — fetch the final output of a completed job.
- `/cursor:cancel` — cancel an active job (SIGTERM → SIGKILL after 5 s).
- `/cursor:resume` — shortcut for `/cursor:delegate --resume`.
- `/cursor:sessions` — list Cursor's own chat sessions via `cursor-agent ls`.
- `/cursor:setup` — health-check, model listing, configured-MCP listing, and optional installer.
- `cursor-runner` subagent for automated task delegation.
- File-backed job registry under `~/.cursor-plugin-cc/jobs/<repo-hash>/`.
