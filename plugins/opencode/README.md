# opencode

Hand a task from Claude Code to the [opencode](https://opencode.ai) CLI, then read
what came back.

Same shape as the `cursor`, `grok` and `agy` plugins in this repo: Claude writes the
brief and keeps the judgement, opencode does the typing in its own context, and the
diff comes back here for review.

## Install

```
/plugin install opencode@ahmadghoniem
/opencode:setup
```

Needs `opencode` on `PATH` (`npm i -g opencode-ai`, `bun add -g opencode-ai`, or the
installer at opencode.ai) with at least one authenticated provider
(`opencode auth login`, or a provider configured in `~/.config/opencode/opencode.json`).
`OPENCODE_BIN` overrides the lookup.

## Commands

| Command | What it does |
| --- | --- |
| `/opencode:delegate` | Dispatch a brief. Prints a job name. |
| `/opencode:result` | Print a finished job's output, or `--list` the tracked jobs. |
| `/opencode:resume` | Continue a session, or `--fork` it. |
| `/opencode:cancel` | Kill a running job and its child processes. |
| `/opencode:models` | The live model list, and the allowlist that governs spending. |
| `/opencode:setup` | Health-check the CLI, its providers, and the allowlist. |
| `/opencode:update` | Upgrade opencode and report what changed. |

## The allowlist

`opencode run` with no `--model` **does not fail**. On 1.18.31 it picks one of the
configured models by itself, and with a hundred-odd models on tap — most of them
metered — that silently spends money the user did not agree to.

So this plugin will not dispatch without a model drawn from an explicit allowlist:

```
/opencode:models                                              # see what exists
/opencode:models --allow nebius/deepseek-ai/DeepSeek-V4.1-Flash
/opencode:models --default nebius/deepseek-ai/DeepSeek-V4.1-Flash
```

The first model ever allowed becomes the default. The list lives in
`~/.cod/config.json`, machine-wide rather than per repository: which models you may
spend on is a property of your accounts, not of the checkout you are standing in.

An empty allowlist is a hard stop, not a warning. That is the point of it.

## Permissions

Every run passes `--auto`, opencode's own approve-everything switch — the counterpart
of `--dangerously-skip-permissions`. A headless run has nobody to answer a permission
prompt, and `OPENCODE_PERMISSION` with `"ask"` would block until the watchdog killed
it. Treat every dispatch as able to edit files and run commands.

## What it does not do

No self-healing. No friction log, no `kaizen` pass, no hooks, no long-lived
`opencode serve` broker to babysit. A run is one `opencode run --format json` child
process with a watchdog on it; when it dies, it dies, and the ⚠ lines say why.

## Reading the output

A clean run prints opencode's write-up plus one stats line with the real cost and
token counts. Anything that could have gone wrong shows up as a `⚠` line.

One trap worth knowing: opencode marks a tool `completed` whenever the tool itself
ran, **including when the command it ran exited non-zero**. A failing test is a
completed `bash` call with the failure in its output, so it raises no ⚠ line. Run the
verification yourself. [`skills/output-contract/contract.md`](./skills/output-contract/contract.md)
is the full contract.

## Layout

```
commands/                the seven slash commands
scripts/delegate.mjs     dispatch, job record, render
scripts/lib/opencode.mjs argv, binary resolution, model cache, headless spawn
scripts/lib/config.mjs   the allowlist gate
scripts/lib/parse.mjs    the --format json event stream
scripts/lib/render.mjs   the ⚠ registry
tests/                   vitest, run with `npm test`
```

## Tests

```
npm install
npm test
```
