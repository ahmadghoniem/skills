# Changelog

## 0.2.0

Rebuilt for opencode 2.x (checked on 2.0.32), in the shape of grok 0.6.0 and agy 0.5.0.

- **Removed the job store, `/opencode:result`, `/opencode:cancel`, `/opencode:resume`,
  `/opencode:models`, the model cache, the allowlist in `~/.cod/config.json`, `--timeout`,
  `--variant`, `--dir`, `--fork` and `--continue`.** Claude Code's background tasks report
  the end of a run, keep its output and stop it. A run now ends with `session: <id>`, and
  `--session <id>` continues it.
- **The session id is named before the run** (`ses_…`, which opencode 2.x requires), so a
  run that dies can still be continued.
- **`--standalone`**: the turn runs in a private server under the run, so TaskStop ends it
  and its shell commands. In opencode's background service they kept running.
- **A default model, always passed:** `nebius/deepseek-ai/DeepSeek-V4.1-Flash-1017`. The
  allowlist's `nebius/deepseek-ai/DeepSeek-V4.1-Flash` now answers 403 on this account;
  opencode with no model picks a configured one, which may be metered.
- **Errors come from opencode's `error` events** (`provider.quota`, `provider.auth`,
  `provider.no-route`), or the end of stderr when there are none.
- **Papercuts** for errors and tools that could not run, and a once-per-release update line
  from the npm registry (`@opencode/cli`; `opencode-ai` is the 1.x line).
- **`CLAUDECODE` is removed** from opencode's environment.
- Process, release and papercut helpers come from `plugins/_shared`.
- **A quota error that names a reset time blocks that model until then**: the next dispatch to it is refused before the CLI starts. `quota.json` keeps each model's last quota error for the council's roster; a run that gets through clears it. None of the CLIs reports remaining quota to a headless caller.

## 0.1.0

First release. Delegates to the opencode CLI, verified against opencode 1.18.31.

- `/opencode:delegate`, `:result`, `:resume`, `:cancel`, `:models`, `:setup`, `:update`.
- Briefs travel as an `-f` attachment, never through argv.
- A model allowlist in `~/.cod/config.json` gates every dispatch. `opencode run` with
  no `--model` does not fail — it picks one of the configured models itself, which may
  be metered — so an unnamed model is refused rather than guessed.
- `--auto` on every run; a headless run cannot answer a permission prompt.
- The `--format json` event stream is folded into a job record: session id, finish
  reason, tool calls, and the run's real cost and token counts.
- A watchdog owns the only clock, since `opencode run` has no timeout flag.
- `tool-errors` counts tools that could not run, not commands that ran and failed;
  `contract.md` says so rather than implying the plugin catches test failures.
