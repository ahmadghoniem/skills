# Unverified claims

Hypotheses about cursor-agent's behaviour that have not been confirmed by a live run.
Each one states its test. Run the test first; only then change the code.

**Verified against:** cursor-agent `2026.10.22-27dcf5f`, Free plan.

**When a claim is settled, delete its section from this file** and record the
outcome in `CHANGELOG.md`. A file of stale hypotheses is worse than no file.

Claims 1, 2, 4, 5, 8, 9, 10, 11 and 12 of the 0.12.0 review were settled in 0.13.0;
see the CHANGELOG.

---

## 1. Non-shell tool failures are not reported

**Severity if true:** medium. A failed write can sit behind a write-up that says it
worked; only the `wander` check would catch it, and only when nothing else changed.

`summariseEvents` reads `result.failure` for `shellToolCall` only. Live runs on
2026.10.22 show `editToolCall` and `readToolCall` with `result.success`; no failed
edit or read has been captured, so the shape of their `failure` is unknown.
`readToolCall.result.success.exceededLimit` (a truncated read) is not reported either.

### Test

Dispatch a brief that writes outside the workspace (for example
`C:/Windows/System32/cursor-test.txt`) and one that reads a file over the read
limit. Record the `tool_call` `completed` events from the job's `.ndjson` log.

### Fix only if confirmed

Collect `tool_call.*ToolCall.result.failure` for every tool as a separate ⚠ line.
Do not flip `success`, for the same reason failed commands do not.

---

## 2. cursor-agent's own time limits

**Severity if true:** low. Recorded so a stall is not blamed on the plugin.

Read from the 2026.10.22 bundle, not from a run:

- No overall run timeout and no idle timeout for a headless run were found.
- A stream stall detector (`stallDetectorConfig`, `failTimeoutMs`, default 30 s,
  minimum 20 s) aborts or retries a model stream that sends nothing for that long,
  logged as "Stream stall detected". The value comes from the server; there is no flag.
- A shell tool call runs in the foreground for 30 s (`timeout: 30000`), then moves to
  the background (`TIMEOUT_BEHAVIOR_BACKGROUND`), with a hard limit of 24 hours.

So a run that hangs in a way the stall detector does not catch runs until
`/cursor:cancel` or `--timeout`.

### Test

Dispatch a brief that runs `sleep 120` in the shell and reports when it ends. Record
whether the model waits, polls a background job, or ends the turn at 30 s.

---

## 3. A post-result hang

**Severity if true:** none today; the reap costs nothing on a run that exits.

`runHeadless` stops a cursor-agent still running 10 seconds after its `result` event,
without marking the run killed. The 0.12.0 plugin had this for older builds. No run on
2026.10.22 needed it: every one exited on its own after `result`.

### Test

Check the job logs for the line `# plugin: cursor-agent still running after its result
event; reaped`. If none appears over several versions, remove the reap.

---

## 4. Capabilities not used

None are bugs; each needs a live run before it is offered.

| Capability | Why it might matter | What to check |
| --- | --- | --- |
| `-w, --worktree [name]` | Runs in a git worktree under `~/.cursor/worktrees/`, so the delegate never touches your working tree. | Where changes land, how they come back, and what the `git status` checks would compare. |
| `--mode plan` / `--plan` | Read-only planning, no edits. | Whether it ends cleanly in print mode. |
| `--sandbox enabled` | A middle ground between `--force` and nothing. | Whether an unknown value is rejected. |
| `--add-dir <path>` | Extra workspace roots, for a spec outside the repo. | Whether files there are readable and writable. |
| `--min-version <v>` | A version gate: exit 0 when met, exit 2 with the reason on stderr when not, exit 1 on an unknown flag (measured on 2026.08.11). | Whether `/cursor:setup` should use it once the plugin needs a floor. |

`--auto-review` should never be passed: it prompts for the calls its classifier does
not approve, and a headless run cannot answer.

---

## Settled, no live run needed

- **`--disable-auto-update` and `--new-session-id` are hidden flags.** Neither is in
  `cursor-agent --help` on 2026.10.22; both are in the bundle and accepted by live runs
  (exit 0, and `session_id` in the stream equals the id passed). A `--help` diff would
  call them removed and be wrong. `--single-turn`, `--disable-indexing`,
  `--disable-codebase-ref` and `--disable-project-configs` are hidden too and not used.
- **No per-run switch for context.** See the README's "What Cursor loads on its own".
  `--exclude-workspace-context` is refused on Free and Plus with
  `RetriableError: [invalid_argument] Workspace context exclusion is not allowed for this
  user, team, or selected model`. The CLI's `getThirdPartyExtensibilityEnabled` is
  `()=>!0` and no caller replaces it; `importThirdPartyPlugins` is hard-coded false, so
  Claude Code plugins are never imported.
- **Hiding the home-folder files was tried and dropped** (2026.10.22, Plus). Cursor reads
  `~/.claude/settings.json` and the home skill folders through `os.homedir()`
  (`USERPROFILE` on Windows), and its own config and chats through `CURSOR_CONFIG_DIR`.
  Pointing `USERPROFILE` at an empty folder, with `CURSOR_CONFIG_DIR` and `HOME` left in
  place, kept the login and git config and cut a "Reply OK" run from 8,389 to 4,769 input
  tokens. The plugin uses stock settings instead.
- **Plus plan models** (2026.10.22): `auto` is refused (`Cannot use this model: auto`);
  plain `grok-4.7`, `grok-4.7-low`, `grok-4.7-low-fast` and `grok-4.7-medium-fast` are
  refused (`Model unavailable on Plus ... with fixed settings`); `grok-4.7-medium` runs,
  although `cursor-agent models` lists all the `grok-4.7-<effort>` ids. `composer-2.5`
  runs; `composer-2.5-fast` is refused. Setting `model` in `cli-config.json` to
  `grok-4.7-medium` lasts only until the next run, which writes `composer-2.5` back.
- **`--trust` is passed again.** A print-mode run in an untrusted repo is refused without `-f`, which the plugin always passes. `--trust` is kept so delegated work runs in folders the main session already trusts.
- **The model in `system`/`init` is a display name** (`"Auto"`, `"Grok 4.7 256K High
  Fast"`). The plugin records only the id it was given.
- **Releases:** `cursor-agent about --format json` reports `latestStatus` and
  `latestVersion`. There is no npm package and no release list; the changelog at
  `cursor.com/docs/cli/changelog` is headed by date.
