# Unverified claims

Findings from a review of 0.12.0 that could **not** be confirmed, because
confirming them requires dispatching a real `cursor-agent` run and this account
is not on a paid plan.

None of these have been acted on. Each one below is a hypothesis with a stated
test. Run the test first; only then change the code. Several would make things
*worse* if the hypothesis is wrong.

Everything in this file was derived from `cursor-agent --help`,
`cursor.com/docs/cli/headless`, `/docs/cli/reference/output-format.md`,
`/docs/cli/reference/parameters.md`, and reading the plugin source — never from
a live run.

**When a claim is settled, delete its section from this file** and record the
outcome in `CHANGELOG.md`. A file of stale hypotheses is worse than no file.

---

## 1. Bare `--resume` may swallow the follow-up prompt

**Severity if true:** high. `/cursor:resume "some text"` silently loses the text.

`buildArgs` (`scripts/lib/cursor.mjs:177-190`) emits, for
`/cursor:resume "fix the edge case"`:

```
-p --output-format stream-json --trust --model auto --force --resume "fix the edge case"
```

`--help` declares `--resume [chatId]` — a Commander *optional-argument* option.
Commander consumes the next token for such an option when that token does not
look like an option. `--resume` sits immediately before the prompt with no
separator, so the prompt may be parsed as the chat id.

The suite cannot catch this: `tests/fixtures/cursor-agent-stub.mjs` ignores
`argv` entirely and replays a fixture. `tests/delegate.fg.test.mjs:243`
("resume.mjs preserves a multi-word non-ASCII prompt") passes while asserting
only what the *plugin* recorded, never what the CLI received.

### Test

In a scratch git repo, run one dispatch to create a chat, then:

```bash
cursor-agent -p --resume "print the string OK and stop" --output-format json
```

- If the model answers "OK" → the prompt survived; **claim is false, change nothing.**
- If it errors about an unknown chat id, or resumes the prior chat while ignoring
  the new text → **claim is true.**

Cross-check by inspecting the raw NDJSON for what prompt the run actually
received.

### Fix only if confirmed

Use `--continue` for the latest-session case. `/docs/cli/reference/parameters.md`
documents it as "Continue the previous session (alias for `--resume=-1`)"; it
takes no argument, so it is unambiguous by construction. Keep `--resume=<id>`
for the explicit case — the `=` form is already safe.

One line at `cursor.mjs:178`. **Do not make this change on the theory alone** —
if the theory is wrong, it swaps working code for a different code path for no
reason.

---

## 2. `system`/`init`'s `model` may be a display name, not an id

**Severity if true:** medium. A warning quotes a string you cannot pass back to
`--model`, and the job record stores it where the table renders it as an id.

`extractResolvedModel` (`scripts/lib/parse.mjs:70-76`) uses `dig()`, an unbounded
recursive search for any string under `model` / `model_id` / `modelId`. In
practice the first hit is the `system`/`init` event's `model` field.

`/docs/cli/reference/output-format.md` documents that field as
`"model": "<model display name>"` and its worked example shows
`"model": "Claude 4 Sonnet"` — a display name.

If so, then:

- `⚠ ran as Claude 4 Sonnet, not the model the dispatch line named` quotes
  something `--model` will reject.
- `scripts/delegate.mjs:190-202` writes that string into the job record's `model`
  field, where `jobtable.mjs:183` prints it as an id and `status.mjs:203` labels
  it `**Model:**`.

The plugin's own fixture (`tests/fixtures/cursor-events/nested-tool-use.ndjson`)
uses `"model":"claude-4.6-sonnet-medium"` and `delegate.fg.test.mjs:123-134`
asserts that id round-trips — so the test may be pinning behaviour the real CLI
does not produce.

### Test

Dispatch anything and grep the raw NDJSON under `~/.ccd/logs/<repo-hash>/`:

```bash
grep -m1 '"subtype":"init"' <log>.ndjson | python -m json.tool | grep -i model
```

Record the literal value. Repeat under `--model auto` and under an explicitly
pinned model — they may differ.

### Fix only if confirmed

Read `system`/`init`.`model` explicitly (`ev.type === 'system' && ev.subtype === 'init'`),
keeping `dig()` as a fallback. Store it as a **separate** field (`ranAsLabel`),
not overwriting `model`, so the job record keeps a re-dispatchable id. Update the
fixture to whatever the real value turns out to be.

Note the explicit-read half is worth doing regardless: `dig()` will happily pick
up a `model` key from an MCP tool's arguments if `init` ever lacks one.

---

## 3. Non-shell tool failures may be silently dropped

**Severity if true:** high. It is the "wrong while still looking done" class the
warning contract exists to catch.

`shellCommandResult` (`scripts/lib/parse.mjs:284-320`) is the only place
`result.failure` is inspected, and it only looks at `tool_call.shellToolCall`.
The documented schema puts every tool's outcome at
`tool_call.<x>ToolCall.result.{success|failure}`.

If that is accurate, a `writeToolCall` that fails — permission denied, path
outside workspace, disk full — plus `readToolCall` failures and denied MCP tools
are all dropped, while the model may still narrate success in its final message.

The doc also mentions `readToolCall.result.success.exceededLimit`, a truncated
read — real signal that the agent worked from a partial file, also dropped.

### Test

Dispatch something that will fail a non-shell tool. Easiest reliable trigger: a
brief instructing a write to a path outside the workspace, e.g.
`C:\Windows\System32\cursor-test.txt`. Then inspect the raw NDJSON for the
`tool_call` event and record the exact shape of its `result` object, plus
whether `result` reports the terminal state as success.

### Fix only if confirmed

Generalise the failure extraction: walk `tool_call.*ToolCall.result.failure` for
any key, collect `{tool, path, message}`, add a warning
`⚠ N tool call(s) failed:`. Keep it factual like the existing command-exit
warning — **do not flip `success`**. A tool failing is not the same as the run
failing, which is exactly the distinction the failed-commands block already
gets right.

---

## 4. Three of four NDJSON fixtures may not match the real schema

**Severity if true:** high, structurally — it is why 1, 2 and 3 are unverifiable
in the first place.

`happy-path.ndjson`, `failure.ndjson`, and `nested-tool-use.ndjson` are
Anthropic Messages-API shaped — `{"type":"tool_use","name":"write"}`,
`{"type":"tool_result","is_error":true}`. `/docs/cli/reference/output-format.md`
shows `cursor-agent` emitting `tool_call` events with
`writeToolCall`/`readToolCall` discriminators instead.

`parse.mjs:170-181` documents having already learned this once ("missing it left
`filesTouched` empty in practice even though the fixture-shaped unit tests
passed") — but the fixtures were never rebased.

### Test

Dispatch one representative run (an edit plus a shell command plus a read),
then compare `~/.ccd/logs/<repo-hash>/<id>.ndjson` against the committed
fixtures event-type by event-type.

### Fix only if confirmed

Commit the real log (redacted) as the primary fixture; keep the synthetic ones
only as explicitly-labelled drift-tolerance cases.

**Do this one first.** It is the prerequisite for trusting any test that touches
event parsing, and it makes 1–3 cheap to settle.

---

## 5. `--stream-partial-output` is deliberately not passed

Not a defect — recorded so nobody "fixes" it.

Without the flag, each `assistant` event is one complete message with no
duplicate flushes, which is what this consumer wants. The headless doc leads with
the partial-output example, so this looks like an omission and is not.

Worth a comment at `cursor.mjs:173` saying so.

---

## 6. Capabilities not used, each needing a live run to evaluate

Ordered by apparent value. None are bugs; all are unexplored.

| Capability | Why it might matter | What to check |
| --- | --- | --- |
| `create-chat` | "Create a new empty chat and return its ID". Calling it before dispatch and running with `--resume=<id>` would make the chat id known *before* any work starts — eliminating the `chatLost` failure mode structurally rather than warning about it. The sibling grok plugin does exactly this with `-s <uuid>`, and it is **verified working there**. | Does `create-chat` return an id on stdout? Does `--resume=<that id>` accept a chat with no turns yet? |
| `-w, --worktree [name]` | Runs the agent in an isolated git worktree under `~/.cursor/worktrees/<repo>/<name>`. For a plugin whose premise is handing `--force` to an external agent and reviewing the diff after, this is the natural safety valve — the delegate never touches your working tree. Probably cursor's strongest differentiator over its siblings. | Where do changes land? How does the user get them back? Does the plugin's `git status` post-flight still see anything? |
| `--mode plan` / `--plan` | Read-only planning mode, no edits. Fits the Claude-plans/Cursor-writes loop from the other direction and is safe without `--force`. | Does it terminate cleanly headlessly, or wait for input? |
| `--sandbox enabled` | An explicit middle ground. Today `force` defaults to `true` (`delegate.mjs:43`) with `--no-force` the only alternative — and `--no-force` in print mode means the agent proposes changes it cannot apply, which produces nothing useful. | Does it reject invalid profile names? (The sibling grok plugin refuses `--sandbox` precisely because grok accepts garbage silently.) |
| `--auto-review` | Server-side classifier auto-runs safe tool calls, prompts for the rest. Almost certainly wrong headlessly *because* it prompts. | Confirm it stalls, then record that it must never be passed. |
| `--add-dir <path>` | Additional workspace roots. Relevant for monorepos and for the `--prompt-file ~/.claude/plans/…` flow where the spec lives outside the repo. | Does agy-style `--add-dir` semantics apply? |

---

## Not in this file

These findings from the same review needed **no** live run and have been handled
separately — they are not hypotheses:

- `--cloud` is not a flag `cursor-agent` has (confirmed from `--help` alone).
- The model-alias tables in `README.md` and `docs/reference.md` document aliases
  deleted in commit `8f0d20a`, and three worked examples tell the reader to run
  `--model opus`, which now forwards a literal string the CLI rejects.
- `/cursor:sessions` calls `cursor-agent ls --output-format json`; `ls --help`
  accepts `-h` only, and `ls` is an interactive picker ("Resume a chat session").
- `runWorker` (`delegate.mjs:288-297`) omits `cliSuccess` from its `updateJob`
  patch while `foreground` includes it, so every background job falls back to a
  derived value.
- `walkToolUses` runs with no subtype filter, so each tool call prints twice and
  the 20-call cap is really 10.
- A post-`result` reap at `cursor.mjs:282-290` is benign by definition but sets
  `killed`, marking good runs `failed`.
- `graphify-out/` is committed at repo root despite commit `d2ab549`.
