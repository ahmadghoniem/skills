# Changelog

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
