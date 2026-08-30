> **Archive pointer.** 2026-08-19 authoring-spec process log. Folded evaluation index is [../README.md](../README.md). Index: [README.md](README.md).

# After: 2026-08-19 best-practices evaluation

For the skill's author. What an external audit of `tailwind/` found, what it changed, and what it deliberately did not touch. Read alongside `EVALUATION-CONTEXT.md`; this file is not part of the skill either.

## Method

- **Sources checked against:** the Agent Skills spec (agentskills.io), Anthropic's skill-authoring best practices (full page, including the effective-skills checklist), the Anthropic engineering blog, skill-creator, writing-for-agents (+ SKILL-MECHANICS), and this repo's own `research-skill-structure.md`.
- **Gathered twice, independently:** a Grok 4.6 research subagent (its output is `research-agent-skills-authoring.md`) and direct fetches of the primary pages. The two agreed; conflicts were resolved toward the spec (e.g. TOC threshold: Anthropic's >100 lines, not skill-creator's >300).
- **Freshness:** `npm view tailwindcss dist-tags` → `latest: 4.3.3`. The 2026-08-18 compile audit still stands; nothing version-specific was re-checked beyond that.
- **Not done:** no re-compilation of the skill's Tailwind claims. Where this file says "consistent," it means *the files agree with each other and with the bug ledger's fixes* — not that the claims were re-verified against the compiler. That remains the 2026-08-18 audit's evidence, per the method in EVALUATION-CONTEXT.md.

## Verdict

Structurally sound against the spec and Anthropic's guidance. One real gap (no behavioral evals — scaffolded, not run), three polish items (applied), three repo notes (one fixed, two logged).

## What was checked and held

**Self-contradiction cross-read** (this repo's highest-yield check — every number, ceiling, and always/never in SKILL.md against what `references/setup.md` ships and `cleanup.md` flags). All clear:

| Check | Where stated | Result |
| --- | --- | --- |
| Opaque-token rule + dark-hairline exception | SKILL.md / setup.md / cleanup.md | Exception present at all three rule sites |
| Chroma ceiling cites the shipped `--destructive` (C 0.245) | SKILL.md ↔ setup.md `:root` | Consistent |
| Emission order (`w-full` beats `w-32`; `text-sm` beats `text-lg`) | SKILL.md ↔ cleanup.md | Consistent with the ledger's compiled finding |
| Bare channels fully dead vs `hsl(var())` complete | SKILL.md / gotchas.md / cleanup.md | Consistent in all three |
| `@utility`, not `@layer utilities` | SKILL.md / setup.md / README | Consistent |
| v3→v4 rename table never runs on v4 code | SKILL.md ↔ cleanup.md | Consistent |
| `rootFontSize` required for px rewrites | editor.md / README | Consistent |
| Vendored shadcn `dark:` left alone | setup.md ↔ cleanup.md | Consistent |

**Structural passes, condensed:** `name` spec-valid and matches the directory; description 340→258 chars (limit 1024); SKILL.md 100 lines / ~1.9k words (caps: 500 lines, ~5k tokens); four references one level deep, each with a named trigger in `## When to load more` — no orphans; TOCs on both >100-line references; forward slashes throughout; the auto-apply / flag / ask ladder matches the official degrees-of-freedom guidance; the "Do not over-correct" section is the pair-prohibition-with-positive pattern done right.

## What changed (commit `e26eb02` on `main`, local)

1. **`SKILL.md` frontmatter.** The description carried a rule — "Tailwind v4 only — never emit v3 patterns" — in always-loaded metadata, as a negation (which activates the banned concept every turn). Rewritten to triggers only; the rule stays in the body's hard-rule paragraph.

   Before: `This skill should be used when writing, reviewing, or cleaning up Tailwind CSS. It provides a Tailwind v4 house style … run on request ("clean up my tailwind", "audit these classes"). Tailwind v4 only — never emit v3 patterns.`

   After: `Tailwind CSS v4 house style (the shadcn semantic-token system, OKLCH) and a class-list cleanup pass. Use when writing, reviewing, or editing Tailwind CSS, and when asked to clean up, audit, or simplify classes ("clean up my tailwind", "audit these classes").`

   Also added `license: MIT` (the README already declared it; the spec field makes it machine-readable).

2. **`evals/` created.** The one real gap: verification here was compile-audits only — nothing tested triggering or end-to-end agent output. `evals/evals.json` holds 5 task evals with checkable `expected_output`s (author-with-tokens, cleanup-drift, scaffold-asks-not-assumes, v3-question-gets-v4-answer, review-does-not-over-correct). `evals/trigger-eval.json` holds 20 trigger queries (10 should / 10 near-miss shouldn't) with the pass criteria embedded. **Authored, not run.**

3. **`EVALUATION-CONTEXT.md`.** Added a "Known open" bullet watch-listing the two claims that will expire — editor.md's Biome `useSortedClasses` nursery status and setup.md's cnfast `v0.1.0` pin — with instructions to re-check them alongside the `dist-tags` freshness check. Removed the "nothing is committed" bullet (resolved by this commit).

4. **`research-skill-structure.md`.** Refreshed the stale self-measurement in both places (16,003 B / 267 lines / 2,184 words → 13,049 B / 100 lines / 1,935 words, re-measured after the frontmatter edit so it doesn't drift on arrival). The §5 "proposed tree" text is left as-is — it documents the reasoning behind the split that has since been applied.

## Deliberately not changed

- **No SKILL.md body edits.** The size question (13KB vs the 2–8KB house-style peer band) was already litigated in `research-skill-structure.md` and the decision log; nothing in the body failed a check.
- **No re-compilation.** The compile-verify ritual is the author's audit to re-run, not something to half-repeat from docs prose.
- **No push.** `main` is ahead of `origin/main` by one commit; until pushed, the documented `git clone` install path still serves the old single-file skill. Pushing is the author's call.
- **Eval placement:** `evals/` went *inside* the skill folder (skill-creator's convention; the spec allows extra dirs; zero context cost since nothing points at it). If the author prefers this repo's "evaluation material lives outside the shipped skill" convention (as with this file and `candidate-*.md`), move it — nothing references its location yet.

## Calibration — how much to trust this file

- The audit used a self-built 28-check scorecard; "21 pass / 3 polish / 3 notes / 1 gap" is self-graded, not an instrument measurement. The direction is reliable; the exact tally is not.
- The description rewrite is **untested**. It follows the official what+when pattern, but no trigger eval was run before or after — the new `evals/trigger-eval.json` exists precisely to measure whether it's actually better. Treat the rewrite as a hypothesis with a harness, not a fix.
- One trigger-set judgment call to review: pure Q&A ("what's new in tailwind v4") is labeled should-not-trigger on the grounds that the skill is for authoring/review/cleanup, not questions. A v3→v4 migration query was removed from the negatives because the skill's boundary knowledge genuinely helps there — re-add it as a positive if you want that covered.
- The "all clear" cross-read inherits the bug ledger's base rate: it found no *internal* contradictions, which is not the same as truth.

## Open

- Push `main` to origin.
- Run the eval suite (skill-creator's loop: with-skill vs baseline, then the trigger set at 3 runs/query, 60/40 split).
- The `@utility` open question from EVALUATION-CONTEXT.md is untouched and still open.
