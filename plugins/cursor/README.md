# claude-cursor-delegate

> **Claude plans. Cursor writes. Claude reviews.**
> A Claude Code plugin that delegates coding _execution_ to Cursor's Composer — without ever leaving the Claude Code TUI.

[![CI](https://github.com/ahmadghoniem/claude-cursor-delegate/actions/workflows/ci.yml/badge.svg)](https://github.com/ahmadghoniem/claude-cursor-delegate/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2018.18-43853d.svg)](https://nodejs.org)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-7c3aed.svg)](https://claude.com/claude-code)
[![Cursor CLI](https://img.shields.io/badge/Cursor-cursor--agent-000000.svg)](https://cursor.com)

## Plan. Delegate. Ship.

```text
you ▸ /plan add a /health endpoint to our Express app that returns { status, version, uptime }

claude ▸ Plan written to ~/.claude/plans/health-endpoint.md
         (4 acceptance criteria, 3 files to touch, verify with `npm test`)

you ▸ /cursor:delegate --prompt-file ~/.claude/plans/health-endpoint.md

plugin ▸ handing off to cursor-agent (composer-2.5-fast, --force)…

cursor ▸ ✓ src/routes/health.ts          (new, 24 lines)
       ▸ ✓ src/app.ts                    (mounted route)
       ▸ ✓ tests/health.test.ts          (new, 3 passing)
       ▸ done in 11s · chat_id=V1StGXR8_Z

you ▸ review the diff

claude ▸ LGTM. Nit: hard-coded "1.0.0" — pull from package.json instead.

you ▸ /cursor:resume "read version from package.json"

cursor ▸ ✓ src/routes/health.ts          (1 line changed)
       ▸ ✓ tests/health.test.ts          (assertion updated, still passing)
       ▸ done in 4s
```

That's the whole loop. Claude does the **thinking** (plan, review). Cursor does the **typing** (file edits, tests). You stay in one TUI.

**Why this is fast:** `composer-2.5-fast` is Cursor's tuned-for-CLI variant — it ships small, well-scoped changes in seconds. Claude Code spends its tokens on planning and reviewing, where thinking actually matters.

## Install

**Preferred — from GitHub:**

```
/plugin marketplace add ahmadghoniem/claude-cursor-delegate
/plugin install cursor@claude-cursor-delegate
/reload-plugins
/cursor:setup
```

**Local, for hacking on the plugin from a checkout:**

```
/plugin marketplace add C:/path/to/claude-cursor-delegate
/plugin install cursor@claude-cursor-delegate
/reload-plugins
/cursor:setup
```

> ⚠️ **Do not skip `/reload-plugins`.** Right after `/plugin install` the `/cursor:*` commands are NOT yet available — Claude Code only picks them up after a plugin reload. If you see `Unknown command: /cursor:setup`, run `/reload-plugins` and try again.

The plugin ships as **plain ESM JavaScript with zero runtime dependencies** — just the Node stdlib. `/plugin install` is literally all you need; no `npm install`, no build step, no `dist/` folder.

### Requirements

- Node.js **≥ 18.18**
- A Cursor account — paid for Composer models; free works with `--model auto` or other entitled models
- `cursor-agent` on your `PATH` — install via `curl https://cursor.com/install -fsS | bash`
  (Windows: `irm 'https://cursor.com/install?win32=true' | iex` — see [Windows](#windows))
- `cursor-agent login` completed at least once

## Windows

Upstream targets POSIX and fails on native Windows in two ways, both fixed here:

- **`spawn EINVAL` on every delegate.** The Windows Cursor CLI installs only shims
  (`cursor-agent.cmd` → `.ps1` → `node.exe index.js`), and Node refuses to spawn a `.cmd`
  without `shell: true` (the fix for CVE-2024-27980). `scripts/lib/winbin.mjs` skips the
  shims and spawns the `node.exe` + `index.js` behind them — no shell, so an arbitrary
  prompt is never exposed to `cmd.exe` `%VAR%` expansion. The same failure made the auth
  probe report a logged-in CLI as logged out.
- **Binary resolution.** `which` does not exist on Windows; `where` is used instead, with a
  fallback to `%LOCALAPPDATA%\cursor-agent\`, since the installer only edits the *persistent*
  user PATH and a Claude Code session started beforehand will not see it.

Install the CLI with the native build, not the WSL one — `irm 'https://cursor.com/install?win32=true' | iex`.
A WSL install is invisible to the plugin, which runs as a Windows process.

`CURSOR_AGENT_BIN` still overrides resolution if you need to point at a specific binary.

Platform support is **Windows and Linux**. See [`docs/reference.md`](docs/reference.md) for details this section doesn't cover.

## The flow

```
┌──────────────────────────────────────────────────────────────────┐
│  1.  /plan <what you want>                                       │
│      → Claude drafts a plan into ~/.claude/plans/<slug>.md       │
├──────────────────────────────────────────────────────────────────┤
│  2.  /cursor:delegate --prompt-file ~/.claude/plans/<slug>.md    │
│      → invokes `cursor-agent -p --force` with the plan as task   │
│      → Cursor reads it, writes the code, reports back            │
├──────────────────────────────────────────────────────────────────┤
│  3.  <your verify command>     e.g. `npm test`, `task test`      │
└──────────────────────────────────────────────────────────────────┘
```

**Iterate:** if Claude's review of the diff finds something, run `/cursor:resume "fix X"` — same Cursor chat, no replanning. **Skip plan mode** for quick one-shots: `/cursor:delegate "<task description>"` goes straight to Cursor. For a spec file already inside the repo, reference it inline with `@path` and Cursor opens it itself; for one outside the repo (like a plan under `~/.claude/plans/`), pass it with `--prompt-file`.

Full walkthrough (typical flows, chunking guidance, the "how I actually use this" recipe) lives in [`docs/reference.md`](docs/reference.md).

## What you get

Six slash commands under the `cursor:` namespace:

- **`/cursor:delegate`** — hand a coding task to Cursor, foreground or background. Task text can come inline, from a file (`--prompt-file <path>`), or from stdin (`--prompt-file -`).
- **`/cursor:result`** — print the final output of a finished job, or `--list` the tracked ones.

Both the foreground write-up and `/cursor:result` flag any shell command Cursor ran that exited
non-zero, under **⚠ Commands that exited non-zero**. It is reported, not judged — a `grep` that
matches nothing or a deliberately red test exits non-zero on purpose — but it catches the case
where a run reads as a success in prose while commands quietly failed underneath it.
- **`/cursor:cancel`** — terminate a running job and everything it spawned (SIGTERM, then SIGKILL after 5 s; `taskkill /T /F` on Windows). Also reaps a record left stuck at `running` because its parent process died.
- **`/cursor:resume`** — continue the previous Cursor chat with a follow-up.
- **`/cursor:sessions`** — list Cursor's own chat sessions for this repo.
- **`/cursor:setup`** — health-check the CLI, list models + configured MCPs, or guide installation.

Plus a `cursor-runner` subagent you can invoke from inside Claude to delegate well-scoped tasks automatically; it carries its own prompt-shaping guidance inline.

## Model selection

Call `/cursor:delegate` **without `--model`** and the plugin recommends one instead of silently defaulting. It reads the live list from `cursor-agent --list-models` and splits it the same way your Cursor dashboard does:

- **Included in your plan** — Cursor's own models (Composer, Cursor Grok). Recommended first.
- **Metered per token** — third-party models (Anthropic, OpenAI, Google, …), suggested only when the task warrants the spend.

You get a pick with a one-line rationale before the job runs, plus a second question offering the model's `-fast` variant — asked only when that model actually has one, since roughly half the lineup doesn't. Fast runs the same model on quicker hardware at about **2x the usage cost**.

The split is derived from Cursor's own id namespacing (`composer*` / `cursor-*`), not a hardcoded model list, so new releases classify correctly with no update.

Passing `--model <id>` bypasses all of this — your explicit choice always wins. Any Cursor model id passes through as-is even if the plugin has never seen it.

## Usage

### `/cursor:delegate <task...>`

Hand a coding task to `cursor-agent -p …`.

| Flag | Default | Effect |
| ---- | ------- | ------ |
| `--model <id>` | recommended automatically (or `$CCD_DEFAULT_MODEL`) | Aliases resolve to real Cursor ids (`composer`/`fast` → `composer-2.5-fast`, `opus` → `claude-opus-4-7-high`, …). Unknown ids forward as-is. Omit this flag to get task-aware model selection — see [Model selection](#model-selection). Run `/cursor:setup --print-models` for the live list. |
| `--background` | off | Detach the worker. Scripting only — it severs the harness notification, which is what forces polling. Claude backgrounds the job for you with the Bash tool instead. |
| `--timeout <sec>` | `1800` | Kill the job if it exceeds this. |
| `--no-git-check` | off | Allow running outside a git repo. |
| `--cloud` | off | Pass `-c` to cursor-agent. |
| `--prompt-file <path\|->` | off | Read the task from a file, or from stdin with `-`. Mutually exclusive with an inline task. For long, multi-line, or quote-heavy specs. |

Prompts over 4 KiB, or containing flag-like tokens (`-X`, `-ldflags`), are handed to `cursor-agent` through a sidecar file rather than on its command line — argv has a hard length limit, and a flag-like token can be re-split by the receiving parser into a different prompt. This is automatic; shorter briefs stay inline.

Full flag reference (`--fresh`, `--resume`, `--no-force`) and more examples: [`docs/reference.md`](docs/reference.md#delegate-flags).

```
/cursor:delegate add a dark-mode toggle to the settings page
/cursor:delegate --model composer "write jest tests for utils/date.ts"
/cursor:delegate "migrate user repository to Doctrine 3"
/cursor:delegate --resume "continue with the failing edge case"
/cursor:delegate --prompt-file ~/.claude/plans/dark-mode.md   # inline a spec/plan file
git show HEAD:spec.md | /cursor:delegate --prompt-file -      # or pipe one in via stdin
```

**Delegating a plan or spec file.** There's no separate command for this — a spec is just a task that lives in a file. If it's **inside the repo**, reference it inline (`/cursor:delegate "implement @tasks/spec.md, follow it exactly"`) and cursor-agent opens it itself. If it's **outside the repo** (a plan under `~/.claude/plans/`, a generated file, anything cursor-agent can't see), read it in with `--prompt-file`. For several independent specs, fan out one delegation per file.

### `/cursor:result [job-id] [--list] [--all]`

Prints cursor-agent's write-up for a finished job. Defaults to the most recent one for this repo.

On a clean run that write-up is the entire output — no status table, no file list, no model id, no timestamps. `git status` and `git diff` are one call away and are the actual ground truth; a formatted summary of them is just something else to read.

What does get surfaced is the set of ways a run can be wrong while cursor-agent still calls it done. Each is its own `⚠` line, and any can fire alone:

| Line | Means |
| --- | --- |
| `⚠ cursor-agent did not report success` | The CLI's own verdict, with its exit reason when there is one. |
| `⚠ exit N` | The process exit code. Independent of the above — they disagree in both directions. |
| `⚠ ran as <id>, not the model the dispatch line named` | Under `--model auto`, the concrete model the run actually used. |
| `⚠ run was killed before finishing` | The watchdog fired; output may be incomplete. |
| `⚠ N commands exited non-zero` | Terminal commands that failed, with up to ten lines of output each. Reported, never judged — a `grep` miss or a red TDD test exits non-zero on purpose. |
| `⚠ no cursor chat id was captured` | A killed run never reported one, so this job cannot be resumed. |

With `--list`, prints a table of tracked jobs instead — the last 10, or every one with `--all`. Running jobs are included, so this is also how you find a job id.

### `/cursor:cancel [job-id]`

Cancels a running job. With no id, cancels the single running job (errors if there are several).

The kill walks the process tree, not just the wrapper: the job record stores the `cursor-agent` pid alongside the wrapper's, and the agent is killed first — on Windows, once the root is gone its descendants can no longer be enumerated. If a pid is already gone, `cancel` says so rather than reporting a kill that did not happen.

### `/cursor:resume [task...]`

Shortcut for `/cursor:delegate --resume <task...>`. Without a task, sends an empty follow-up ("continue").

### `/cursor:sessions`

Shells out to `cursor-agent ls` and lists Cursor's own chat sessions for this repo, falling back to the local job registry if that call times out or returns empty.

### `/cursor:setup [--doctor] [--print-models] [--install]`

Quick health-check. `--doctor` gives extended diagnostics. `--print-models` shells out to `cursor-agent --list-models`. `--install` prints (but does not run) the install command.

See [`docs/reference.md`](docs/reference.md) for the two-phase loop philosophy, prompt-writing guidance, chunking rules, and worked examples for every command.

## Configuration

| Env var | Purpose |
| ------- | ------- |
| `CURSOR_API_KEY` | Forwarded to `cursor-agent`. Optional — `cursor-agent login` is usually enough. |
| `CURSOR_AGENT_BIN` | Override binary path (used by the test suite). |
| `CCD_HOME` | Override the jobs-registry root (default `~/.ccd`). |
| `CCD_DEFAULT_MODEL` | Default `--model` when none is passed, bypassing task-aware selection. Accepts the same aliases as `--model`. |

Every finished job stores the Cursor `chat_id` — read it from `/cursor:result`, then run `cursor-agent --resume=<chat_id>` in any terminal to keep going outside Claude Code.

A repo-local `.ccd.json` is on the roadmap for overriding the default model per repo.

## FAQ & Troubleshooting

Common questions (Node version, auth, `--force` semantics, model-list drift) and fixes for the failure modes that came up during development (`Unknown command: /cursor:setup`, stale plugin cache, `cursor-agent` hanging) are collected in [`docs/reference.md`](docs/reference.md#faq) and [`docs/reference.md`](docs/reference.md#troubleshooting).

## Contributing

Plugin users can skip this section — there is nothing to build.

Contributors, read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev setup, branch naming, the "how to add a new slash command" recipe, and the release flow. The hard rules (zero runtime deps, no build step, etc.) live in [`AGENTS.md`](./AGENTS.md). Reporting a vulnerability? See [`SECURITY.md`](./SECURITY.md).

CI runs `npm test` and `npm run lint` on every PR across Node 18.18 / 20 / 22 on Windows + Linux. No direct pushes to `main` — branch protection enforces PR review.

## Roadmap

See [`CHANGELOG.md`](./CHANGELOG.md) for the deferred backlog (`--prompt-file`/stdin, a skills→`.cursor/rules` compiler, self-verify against acceptance criteria, and more). Contributions and ideas welcome.

## Credits / Acknowledgements

This project builds on [freema/cursor-plugin-cc](https://github.com/freema/cursor-plugin-cc) by Tomas Grasl (MIT-licensed) — the original Claude-plans/Cursor-writes plugin design. This fork started as a Windows-compatibility patch and has since grown its own feature set (task-aware model selection, a slimmed `ccd` namespace, and more), but the core idea and a good amount of the plumbing trace back to that upstream project. Thank you, Tomas.

It also borrows structurally from [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) for the review-command and skill patterns.

## License

MIT — see [LICENSE](./LICENSE). See also [NOTICE](./NOTICE).
