# Changelog

Changes to mngr as a whole. Each CLI's own history is in `clis/<cli>/CHANGELOG.md`, the council's in `council/CHANGELOG.md`.

## 0.3.0

- **One delegate run for every CLI** (`scripts/lib/shared/delegate.mjs`). Reading the task, the model check, quota, the release notice, papercuts and the printed result are written once; each CLI's `delegate.mjs` is now a small adapter: its flags, how it takes model and effort, how to start it and read its output.
- **The session id is printed when the run starts**: `model: <id> (<cli>) · session: <id>` is the first line, so a stopped or stuck run can still be continued. The last line still names it too.
- **Every fresh brief ends with a note** that nobody can answer questions during the run, to keep working, to stop and say so only if a question blocks the task, and to list questions under "Open questions" at the end.
- **A model the CLI doesn't list is refused before anything starts**, with the close matches (`agy has no model gemini-4-neon-max. Close matches: gemini-4-neon-high, …`). grok's list is read from its own cache file on every run; agy's and opencode's lists are cached for a day in `~/.mngr/<cli>/models.json`, and read again once when a model is missing, so a new model works the day it ships. If a CLI can't list its models, the run goes ahead and the CLI judges the id.
- grok drops its `workflow` tool in delegate runs (see `clis/grok/CHANGELOG.md`).

## 0.2.0

- **The council plugin merged in** as `/mngr:council` (see `council/CHANGELOG.md`). One plugin to install; `plugins/_shared` and `tools/sync-shared.mjs` are gone, since only mngr uses the helpers now: `scripts/lib/shared/` is the one copy.
- **The update notice always gives a count:** "opencode 2.4.2 is out, 1 release after your 2.4.1", not only when two or more are out.
- **Shorter placeholders** for `/mngr:delegate` (`<grok|agy|opencode> <what to change, or what to find out>`) and `/mngr:papercut`.
- agy drops `--sandbox`; opencode requires `--model` (see each CLI's changelog).
- **Scripts no longer crash on exit after a web request.** `process.exit` right after a `fetch` hit a Node assertion on Windows (`UV_HANDLE_CLOSING`, exit 127), which the update scripts and the roster's new grok read both do. A script now ends on its own and is made to exit 2 s later only if something is still running. The bug is Node's (nodejs/node#56645). **On Windows, use Node 24.20.0 or later** (or 26.7.0 or later). The reason: on older versions, calling `process.exit()` while a background task is still posting to Node's closing event loop aborts the process, and a recent `fetch` makes that likely. mngr no longer exits that way, but any other script on the machine that does (Claude Code hooks, other CLIs) still crashes with the same assertion.

## 0.1.0

The grok (0.6.0), agy (0.5.0) and opencode (0.2.0) plugins merged into one.

- Commands take the CLI as their first word: `/grok:delegate` is now `/mngr:delegate grok`, and likewise `setup`, `update` and `papercut`. `/mngr:delegate` with no CLI asks which; `/mngr:setup` and `/mngr:update` with none cover every CLI.
- One version, one `package.json` (`engines.grok`, `engines.agy`, `engines.opencode`) and one copy of the shared helpers. Each CLI keeps its scripts, tests, contract and changelog under `clis/<cli>/`.
- The brief-writing rules are written once, in `/mngr:delegate`; what differs per CLI (what it reads, models, flags) is in `clis/<cli>/delegate.md`.
- Data moved from `~/.cgd`, `~/.cad` and `~/.cod` to `~/.mngr/grok`, `~/.mngr/agy` and `~/.mngr/opencode`. `CGD_HOME`, `CAD_HOME` and `COD_HOME` are now `MNGR_GROK_HOME`, `MNGR_AGY_HOME` and `MNGR_OPENCODE_HOME`, and `MNGR_HOME` moves all three.
