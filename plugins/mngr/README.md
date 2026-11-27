# mngr

Manage three coding CLIs from Claude Code, and hand them work: [grok](./clis/grok/README.md) (Grok Build), [agy](./clis/agy/README.md) (Antigravity) and [opencode](./clis/opencode/README.md). Claude writes the brief and reviews the diff; the CLI does the editing in its own session. mngr never commits.

`/mngr:council` seats them as a review council: the [council](./council/README.md) runs each seat through the same delegate scripts.

## Install

```bash
claude plugin marketplace add ahmadghoniem/skills
claude plugin install mngr@ahmadghoniem
```

Windows only, Node 18.18+, and each CLI you use on `PATH` at the version in `package.json` `engines.<cli>` or later. Each CLI's README lists what it needs.

## Commands

Every command takes the CLI as its first word. With none, `/mngr:delegate` asks which; `/mngr:setup` and `/mngr:update` cover all three.

- **`/mngr:delegate <cli> <task>`** writes a brief to `~/.mngr/<cli>/briefs/` and runs the CLI on it in a background Bash call. The output ends with the session id that continues the work. TaskStop stops a run.
- **`/mngr:setup [cli]`** checks the binary, the version and the sign-in, and installs agy's bash tool.
- **`/mngr:update [cli]`** updates the CLI, lists the releases since the version mngr was last reviewed against, and reviews mngr and the open papercuts against them.
- **`/mngr:papercut <cli>`** records what the CLI said blocked it, or closes papercuts once fixed.
- **`/mngr:council [seats:] <question>`** convenes the seats you name as a review council. It shows the roster (exact models, quota) and starts only once you approve it.

## Layout

```
commands/            the five commands; CLI-specific guidance is read from clis/<cli>/
scripts/             entry points: take the CLI name, hand the rest to clis/<cli>/scripts/
scripts/lib/shared/  helpers every CLI and the council use
clis/<cli>/          one CLI: scripts, tests, contract.md, delegate.md, update.md, CHANGELOG.md
council/             the council: round, roster and check scripts, tests, README, CHANGELOG
```

Data lives in `~/.mngr/<cli>/` (`MNGR_HOME` moves `~/.mngr`; `MNGR_<CLI>_HOME` moves one CLI's folder): briefs, the papercut log, the release cache and the quota record. Councils live in `~/.mngr/council/<name>/` (`COUNCIL_HOME` moves it).

`npm test` runs the dispatcher's and shared helpers' tests, then each CLI's suite and the council's; `npm run test:<cli>` or `npm run test:council` runs one.
