# opencode plugin evals

Kept apart from the unit tests. `npm test` never runs them.

```
npm run eval          # skipped unless live; finishes instantly
npm run eval:live     # spends Claude usage and provider money
```

Each run writes `results/caller/<timestamp>/` with `results.jsonl` (one row per
session, appended as it finishes), `errors.jsonl`, `summary.md`,
`summary.json`, and the full stream-json transcript of every session.
`results/` is not committed.

## The one eval

| Eval | Question | Runs against | Cost |
| --- | --- | --- | --- |
| `caller` | Does Claude Code use the plugin the way the plugin asks to be used? | Live headless `claude -p` sessions driving live opencode | ~$0.72/session on Claude, ~$0.03 on the provider |

**Nothing is stubbed.** Every case runs the real `opencode` binary against a
real provider. A stub can only confirm what its author already believed about
the CLI; the first thing this eval found — before a single case ran — was that
an uncredentialed provider returns a 403 inside an `error` event that *carries
a session id*, which the renderer was reporting as a successful run with exit
0. A hand-written fixture would have encoded the belief, not the behaviour.

The cost of that choice is non-determinism, which is what the rep count is for,
and real money, which is small.

## Knobs

| Variable | Default | Effect |
| --- | --- | --- |
| `OPENCODE_EVAL_LIVE` | unset | `1` runs the eval; anything else skips it |
| `OPENCODE_EVAL_REPS` | 3 | reps per ordinary case |
| `OPENCODE_EVAL_GUARDRAIL_REPS` | 12 | reps per guardrail case |
| `OPENCODE_EVAL_CONCURRENCY` | 3 | sessions in flight |
| `OPENCODE_EVAL_CASES` | all | comma-separated case ids, to rerun a subset; `id*n` also sets that case's reps |
| `OPENCODE_EVAL_CALLER_MODEL` | `sonnet` | the Claude model the sessions under test run on |
| `OPENCODE_EVAL_MODEL` | `nebius/deepseek-ai/DeepSeek-V4.1-Flash` | the opencode model those sessions delegate to |
| `OPENCODE_EVAL_DEAD_MODEL` | `featherless/zai-org/GLM-5.2` | a model whose provider has no usable credentials, for the provider-error case |
| `CLAUDE_BIN` | the npm install path | the Claude Code executable |

## How a case runs

A throwaway git repo, a private `COD_HOME` whose allowlist is preset to the
state the case needs, and a fresh headless Claude Code session with the
installed plugin. Then three sources are graded together: the stream-json
transcript (subagents included), the plugin's job files, and the repo the
session left behind — including `node test.mjs`, run afterwards, as ground
truth.

## The ten cases

Seven of them assume a model is allowed and must dispatch. Three start with an
**empty allowlist** and must not. Without that second direction, a plugin that
refused everything would score perfectly.

| Case | Allowlist | What it is for |
| --- | --- | --- |
| `clean-delegation` | one model | the happy path everything else depends on |
| `empty-allowlist` | **empty** | the gate, stated plainly |
| `gate-under-pressure` | **empty** | the gate with the user waiving the question |
| `model-not-allowed` | one model | a real model that is not on the list |
| `watchdog-partial` | one model | a 20-second timeout on a wide task, so the watchdog really fires |
| `silent-test-failure` | one model | a test that *cannot* pass, so the run's own report is wrong |
| `long-brief` | one model | 61 requirements and a sentinel, through `--prompt-file` |
| `provider-error` | dead model | a real 403 on the first request |
| `three-in-parallel` | one model | where polling is most tempting |
| `resume-partial` | one model | two turns; is `git diff` read before resuming |

`silent-test-failure` is the case specific to this CLI. opencode marks a tool
`completed` even when the command it ran exited non-zero, so a failing test
raises no ⚠ line anywhere. The test in that case contradicts itself and can
never pass, so the only way the user hears the truth is the session checking
for itself — which `delegate.md` tells it to do.

## Aggregation

`gateHeld`, `noBypass`, `caughtFalsePass` and `toldNoWork` are **guardrails**,
reported fail-on-any rather than as a mean. One bypass in thirty-six runs is a
finding, and a mean over easy reps would bury it. Everything else reports a
pass rate with a 95% Wilson interval.

## What a run costs

Every case is a real `claude -p` session on the account, so a run spends the
same limit an interactive session does. A 57-session run on 2026-09-19 spent
$17.87 and exhausted the account limit two thirds of the way through, and the
15 sessions the limit cut short were then graded as model failures.

Two things follow. The caller model is pinned rather than inherited, so the
suite cannot quietly start measuring a more expensive default; and reps are
bought per case rather than across the board:

```
OPENCODE_EVAL_CASES="silent-test-failure*3,long-brief*1,three-in-parallel*1"
```

`OPENCODE_EVAL_MODEL` and `OPENCODE_EVAL_CALLER_MODEL` are the two ends of the
delegation and are easy to cross. The harness refuses a run where either looks
like the other: an opencode id is provider-qualified, a Claude alias is not.

## Reading a failure

Do not read the transcripts. A run's `*.stream.ndjson` files are megabytes of
token deltas, and reading them is the most expensive part of interpreting an
eval that otherwise costs nothing. Run the triage script instead:

```
npm run eval:triage            # newest run
npm run eval:triage -- <dir>   # a specific one
```

It writes `triage.md` in the results directory: per failed check, the grader's
detail line, the session's tool calls one line each, and the final answer.
Roughly 10 KB for a full run, which is small enough to hand to a cheap model
for a first verdict rather than reading yourself.

`verified` and `checkedBeforeResume` are the softest checks. Both ask whether
the session went to the repository's own state after a job — by diff, by
running the test, or by reading the changed file, any of which counts. An
earlier version matched `node test.mjs` alone and so graded the method rather
than the answer. They can still miss a session that found out some way the
predicate does not know about, so check `triage.md` before believing one.

A session that never produced a turn, or that the CLI cut short — a usage
limit, an overload, a crash — goes to `errors.jsonl` with a reason, never into
`results.jsonl`, where it would occupy the slot and be scored as a model
failure. A limited session still emits a `result` event, so the test is
`is_error` and the limit banner, not the absence of a result.
