# Asking agy for parallel tool calls: why we stopped

Status: dropped on 2026-10-13. Untracked note; do not retry without a new reason (a new agy
version that sends its batch-calling prompt, or a model that batches unprompted).

## The idea

Claude Code often makes several independent tool calls in one response. Model time is about
90% of an agy job's wall time and each turn costs 2–3 s, so a turn saved is time saved. The
idea was to get agy's model to do the same, mostly by asking for it in the agent prompt.

## Verdict

Prompt lines do not make Gemini Flash batch calls in agy, and stronger lines make runs slower.
Where the model does batch, agy runs the calls one after another, so a batch saves at most
the model turn, never tool time. Getting one call to do more work (labelled sections in one
bash call) is what works, and parallel-call wording weakens it.

## Evidence

### 1. Today's A/B on agy-chore (2026-10-13)

8 ContextBench tasks, `gemini-3.8-flash-low`, 3 rounds, 24 runs per arm, alternating arms.
The tested line was added after the bash-batching line, not in place of it:

> When a search has found several files you need to read, view them in one response: one
> view_file call per file, all in the same response, rather than one file per turn.

| arm | wall mean / median | tool calls per run | views per run | turns with 2+ calls | file F1 | line P / R |
|---|---|---|---|---|---|---|
| with the line | 24 / 20 s | 8.9 | 5.0 | 0 of 213 | .854 | .59 / .61 |
| without | 22 / 18 s | 7.5 | 4.3 | 0 of 181 | .841 | .58 / .59 |

Not one multi-call turn. With the line the model viewed more and took more turns.
Data: `~/bench-cb/p{1,2,3}-{par,plain}`, counted from brain transcripts by `~/bench-cb/partu.mjs`.

### 2. Same-time A/B on agy-chore (2026-10-11, cloud, r16–r22)

10 tasks, `gemini-3.7-flash-low`. The "new line" replaced "Each tool call costs a turn" with
parallel-call wording.

| group | turns mean | turns with >1 call | wall mean | labels per bash call | bash calls with ≥2 labels |
|---|---|---|---|---|---|
| old line, r19+r21 | 10.3 | 0 of 206 | 23.9 s | 1.39 / 1.26 | 43% / 39% |
| new line, r20+r22 | 11.7 | 2 of 233 | 25.1 s | 0.45 / 0.65 | 9% / 23% |

The new line produced 2 parallel turns in 233 and halved batching inside bash calls. The
old line went back in. (Session `06dc627c`, 2026-10-11 21:05.)

In r16–r18 the only 3 parallel turns were all on one task (`14da06bc`), each viewing 3 files
an earlier search had found; one of them carried a mistyped path and failed.

### 3. Corpus count over 498 local conversations (2026-10-08)

20,404 turns, 124 parallel turns. 104 of the 124 were `view_file`-only batches.

| agent / prompt | model | conversations | turns | parallel turns |
|---|---|---|---|---|
| agy-delegate with "Make independent tool calls together in one response" | 3.7 | 52 | 1,332 | 22 (1.7%) |
| agy-delegate, no line | 3.7 | 6 | 149 | 0 |
| default agy agent | 3.7 | 33 | 1,123 | 0 |
| agy-chore with the lines of the time | 3.7 | 17 | 612 | 3 (0.5%) |
| agy-delegate with the line | 3.8 | 36 | 496 | 29 (5.8%) |
| agy-delegate, no line | 3.8 | 84 | 2,015 | 14 (0.7%) |
| default | 3.8 | 186 | 14,136 | 39 (0.3%) |

On 3.7 the line saved about 3% of turns and did not reduce back-to-back `view_file` reads
(52% of all `view_file` turns followed another one). (Session `75248869`, 2026-10-08 23:34.)

### 4. A stronger parallel line made lookups slower (2026-09-26 to 09-29)

Lookups with an extra batching line took 486 s and 49 turns, against 238 s and 36 without it.
In one run the model started 4 background commands and sat idle for 15 minutes. (Sessions
`ef223933` and `75248869`.)

### 5. The cloud baseline (2026-10-11, r1–r12)

In 3,399 turns, stock agy included, every turn made exactly one tool call: 0 of 996 in
r7–r9 and 0 of 802 in r10–r12. (Session `3b1c2be7`, 13:57.)

### 6. Batching happens when the files are named in the brief

- A probe told to read 5 named files read them in one turn (2026-10-08).
- The Sonnet/Gemini probe (2026-10-12, session `c0a0d233`): told to "view these 3 files in
  parallel, in a single response", both `claude-sonnet-5-5-low` and `gemini-3.8-flash-low`
  made 3 `view_file` calls in one turn.

So the model can batch; it does not choose to when it has to find the files first, which is
the normal case for a lookup. The plugin's `--read` flag, since removed, put files the brief
named in the first message at zero turns.

### 7. agy runs a batch one call at a time

In every multi-call turn checked, each call's ACTIVE→DONE pair finished before the next
call's ACTIVE. In the probe: 0.03 s per view on Gemini; 2.7, 1.9 and 0.16 s on Sonnet. So a
batch saves the model turn, not tool time. (Sessions `06dc627c` and `c0a0d233`.)

### 8. agy's own prompt for batching is not sent

The agy binary contains a `disable_parallel_tool_calls` field
(`CompletionConfiguration.GetDisableParallelToolCalls`) and a prompt fragment, "You support
batch function calling… you SHOULD call multiple tools in parallel in a single turn." That
fragment was in none of the 111 stored requests scanned, stock or custom. The field's value
is not visible. Nothing in settings, flags or docs turns it on. (Session `3b1c2be7`.)

### 9. Nobody else reports a fix (2026-10-11)

A Grok search of X found no prompt, setting or MCP design that makes Gemini Flash in
Antigravity/agy batch calls reliably. Antigravity's documented route to parallel work is
subagents. Gemini CLI (the older tool) saw redundant parallel calls when its prompt pushed
for them (issue #26643). (Session `06dc627c`, 20:14.)

## What works instead

- **Labelled sections in one bash call.** "Run independent searches in one bash call: print
  `echo '== <label>'` before each command…" The bash tool shortens each section on its own.
  This is batching inside one call, and the A/B in section 2 shows it is the thing parallel
  wording damages.
- **Fewer, larger views** (whole files up to 800 lines), and the 120-word report limit (since
  removed), which cut views from 5.0 to 4.1 per run.

## What it would take to try again

- An agy release that sends its batch-calling fragment or exposes `disable_parallel_tool_calls`.
- A model that batches unprompted (Sonnet made several calls in 5 of 10 tool-calling turns).
- Even then, agy runs the calls one at a time, so the gain is the model turn only.
