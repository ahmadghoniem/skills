# Changelog

Changes to mngr as a whole. Each CLI's own history is in `clis/<cli>/CHANGELOG.md`.

## 0.1.0

The grok (0.6.0), agy (0.5.0) and opencode (0.2.0) plugins merged into one.

- Commands take the CLI as their first word: `/grok:delegate` is now `/mngr:delegate grok`, and likewise `setup`, `update` and `papercut`. `/mngr:delegate` with no CLI asks which; `/mngr:setup` and `/mngr:update` with none cover every CLI.
- One version, one `package.json` (`engines.grok`, `engines.agy`, `engines.opencode`) and one copy of the shared helpers. Each CLI keeps its scripts, tests, contract and changelog under `clis/<cli>/`.
- The brief-writing rules are written once, in `/mngr:delegate`; what differs per CLI (what it reads, models, flags) is in `clis/<cli>/delegate.md`.
- Data moved from `~/.cgd`, `~/.cad` and `~/.cod` to `~/.mngr/grok`, `~/.mngr/agy` and `~/.mngr/opencode`. `CGD_HOME`, `CAD_HOME` and `COD_HOME` are now `MNGR_GROK_HOME`, `MNGR_AGY_HOME` and `MNGR_OPENCODE_HOME`, and `MNGR_HOME` moves all three.
