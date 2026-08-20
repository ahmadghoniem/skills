# 09 — Trigger eval, actually run

`tailwind/evals/trigger-eval.json` (20 queries: 10 `should_trigger`, 10 near-miss negatives) run
against a real Claude Code harness rather than reasoned about.

## Method

The skill is installed to `~/.claude/skills/tailwind`, the `description:` line is rewritten per
variant, then each query runs as:

```bash
claude -p "<query>" --output-format stream-json --verbose --max-turns 1 --model sonnet < /dev/null
```

A query counts as **fired** if the stream contains a `Skill` tool call with `{"skill":"tailwind"}`.
Working directory is an **empty temp dir** — no Tailwind project, no `CLAUDE.md`, nothing in the
environment hinting at the topic. That is the hardest case for a skill and the only way to isolate
the description as the variable.

### The harness bug that invalidated the first pass

The first runner looped `while read q; do claude -p "$q" & done < queries.txt`. Backgrounded
`claude` inherited the loop's stdin, read the *rest of the file*, and appended it to the prompt.
Every run was answering all twenty queries at once — the tell was a model reply beginning *"This
message contains ~20 distinct, unrelated requests."* Fixed with `< /dev/null`.

**Any number from before that fix is void**, including an earlier reported 5–6/10. Everything below
is from the corrected harness.

## Results

| Variant | Chars | Positives | Negatives |
| --- | --- | --- | --- |
| **B** (previous) | 199 | 3/10 | 10/10 |
| **E** (shipped) | 154 | 3/10 | 10/10 |
| **E** rerun | 154 | 3/10 | 10/10 |
| **F** | 113 | 2/10 | 10/10 |

- **B** — *"Tailwind CSS v4 house style: semantic tokens, OKLCH, canonical syntax. Use when writing or reviewing Tailwind, cleaning up class lists, fixing theme tokens, or when a utility silently isn't applying."*
- **E** — *"Tailwind v4 house style: semantic tokens, OKLCH, canonical syntax. Use when writing, reviewing, or cleaning up Tailwind, or when a utility isn't applying."*
- **F** — *"Tailwind v4 house style: semantic tokens, OKLCH, canonical syntax. Use for any Tailwind class-list or theme work."*

Fires under B and E: **01** (clean up `Sidebar.tsx`), **02** (audit these classes), **08**
(`bg-[--brand]` renders nothing). Identical hit/miss sets, reproduced across two E runs.

## Findings

**1. B's extra 45 characters buy nothing.** E is 23% shorter and produced the *same seven misses*
twice. "Cleaning up class lists" and "fixing theme tokens" are decoration — the queries they
describe (01, 03, 07) either already fire on the topic word or do not fire at all.

**2. One clause is load-bearing.** F differs from E only by dropping *"or when a utility isn't
applying"*, and loses exactly query 08 — the one where a utility isn't applying. Naming a
**symptom** earns a firing that naming a **task** does not.

**3. Negatives are free.** 40/40 across all four rounds, including the two that name Tailwind while
wanting nothing from the skill ("what's new in tailwind v4?", "deploy my tailwind site to vercel").
There is no over-firing to trade against, so the description could be broadened without cost — it
just does not help.

**4. Wording is not the ceiling.** Seven positives never fired under any variant. They share a
shape: each looks like something the model can simply **do** — write a settings page, debug a
`truncate`, shorten a class list, set up a fresh project. Skill invocation is a judgment about
whether help is *needed*, and no phrasing changes that judgment.

## Verdict

**E ships**, at 154 chars for 199. Same trigger rate, 23% less always-on context, one clause
identified as doing the actual work.

Positives sit at **0.3** in an empty directory, under the spec's ≥0.5 threshold. That threshold was
written for three runs per query against a realistic workspace; a repo with Tailwind files, a
`globals.css` and a `CLAUDE.md` gives the model far more to go on, and the earlier (void) numbers
suggest it does fire more there. **This is an unmeasured claim** — nobody has run the eval inside a
real Tailwind project yet, and that is the next thing worth doing.

If the goal is to raise the rate rather than measure it, the lever is a hook on Tailwind file edits,
which bypasses model judgment entirely. More description verbs have now been tested twice and do
nothing.
