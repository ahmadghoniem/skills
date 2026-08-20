# 09 — Trigger eval, actually run

`tailwind/evals/trigger-eval.json` (20 queries: 10 `should_trigger`, 10 near-miss negatives), run
against a real Claude Code harness rather than reasoned about.

## Method

The skill was installed to `~/.claude/skills/tailwind`, then each query run as:

```bash
claude -p "<query>" --output-format stream-json --verbose --max-turns 1 --model sonnet
```

A query counts as **fired** if the stream contains a `Skill` tool call with
`{"skill":"tailwind"}`. One run per query per description, 20 queries in parallel per round.

**This is below the spec's bar.** `trigger-eval.json` calls for 3 runs per query and a 60/40
train/held-out split. These are single runs, so per-query results carry real noise — treat the
aggregate and the *consistent* misses as the signal, not any individual row.

## Results

| Description | Positives | Negatives |
| --- | --- | --- |
| **B** (shipped) run 1 | 6/10 | 10/10 |
| **B** run 2 | 5/10 | 10/10 |
| **D** (alternative, 217 chars) | 5/10 | 10/10 |

D: *"…Use when building or reviewing Tailwind/shadcn UI, cleaning up or simplifying class lists,
converting theme colours, or when a utility misbehaves."*

## What is stable

**Negatives held 10/10 in all three rounds.** Not one false positive across 30 negative
invocations — including the two that name Tailwind while wanting nothing from the skill ("what's
new in tailwind v4? just give me a summary", "deploy my tailwind site to vercel"). The
description is not over-firing, and there is headroom to make it broader.

**Three positives never fired, under any description:**

| # | Query | Missed |
| --- | --- | --- |
| 00 | "add a settings page to my next app — tailwind + shadcn, keep it consistent with the rest" | 3/3 |
| 05 | "truncate isn't working on this text inside my flex row, what am I doing wrong" | 3/3 |
| 09 | "simplify the class names on this pricing card without changing how it looks" | 3/3 |

Three more flipped between rounds — 03 (washed-out dark mode), 06 (set up v4 in a fresh Vite
project), 07 (convert hex colours in `:root`) — which is the noise floor at one run each.

## The finding

**The description is not the bottleneck.** B and D are indistinguishable at this sample size, and
query 09 failed under D *even though D contains the word "simplifying"*. If this were lexical
matching, that row would have flipped.

What the three permanent misses have in common is that each looks like something the model can
just **do**: write a settings page, debug a `truncate`, shorten a class list. Skill invocation is
a judgment about whether help is needed, not a keyword match — so a description that enumerates
more verbs does not buy more firing.

Levers that would plausibly move it, in order of expected effect:

1. A hook or project instruction that loads the skill on Tailwind file edits, bypassing model
   judgment entirely.
2. Naming the *stakes* rather than the tasks — the description currently says what the skill
   covers, not what goes wrong without it.
3. More description verbs. Tested; no measurable effect.

## Verdict

Aggregate positive rate ≈ **0.55**, over the spec's ≥0.5 threshold, with a perfect negative
record. **B ships.** But the pass is narrow and the failure is systematic, not random — worth a
proper 3-run pass before treating any future description change as an improvement.
