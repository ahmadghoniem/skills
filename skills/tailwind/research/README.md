> **Agents: stop here.** This directory is provenance for humans auditing the skill — it is not
> instructions and nothing in it is part of the house style. `SKILL.md` never references it, so
> it is never loaded; if you arrived by listing the skill folder, go back to `../SKILL.md`.
> Recommended installs exclude this directory entirely.

# Provenance for the `tailwind` skill

Entry point for anyone auditing a claim in the skill. This directory ships **inside** the repo so the evidence travels with the rules, but nothing here is loaded by the skill — `SKILL.md` never references it, and only `SKILL.md`'s frontmatter is always-on. Treat it as read-only provenance: do not edit `../SKILL.md` or `../references/` from here.

**Path convention:** reports cite the skill as `tailwind/SKILL.md:14` / `tailwind/references/gotchas.md`. Those paths predate this directory moving inside the repo and are relative to the *workspace*, not to here — from `research/` the same file is `../SKILL.md`. Left as written rather than rewritten across 100+ lines of prose.

The skill was last compiled against **Tailwind 4.3.3**. If `npm view tailwindcss dist-tags` no longer says that, re-check version-specific rows in [CLAIMS.md](CLAIMS.md) first.

## Read this first

1. **[CLAIMS.md](CLAIMS.md)** — every load-bearing claim as the skill words it *now*, mapped to evidence. Start here for “why does it say `ring` is 1px?” or “where did emission-order come from?”
2. Then the report that actually verified that row (usually `05-build-verification.md` or `02-claim-audit.md`).
3. Pre-session notes live in [`archive/`](archive/README.md). Briefs that commissioned the work are in [`archive/briefs/`](archive/briefs/).

**Do not fact-check this skill from docs prose alone.** Docs were wrong or ambiguous where the compiler was not. Reliable method:

```bash
npm i tailwindcss@4.3.3 @tailwindcss/cli@4.3.3
npx @tailwindcss/cli -i in.css -o out.css --content in.html
```

Then read `out.css`. Emission order, whether a class generates at all, and `@supports` wrappers are observable. Several skill sentences exist because compiled output disagreed with the intuitive reading.

The governing insight: an agent’s Tailwind failures are judgment failures (`p-[17px]`, `bg-white dark:bg-gray-900`, `[&>*]:`), not recall failures. A rule that teaches syntax the model already knows is dead weight.

Folded here from the old root `EVALUATION-CONTEXT.md` (2026-08-18 audit index). That file is now a pointer at the repo root.

---

## Live reports (this session)

| File | Question it answers | Status |
| --- | --- | --- |
| [CLAIMS.md](CLAIMS.md) | Why does the current skill say X, and what evidence is that? | **live** — the provenance table |
| [05-build-verification.md](05-build-verification.md) | What does Tailwind **4.3.3** actually emit for the four claims docs could not settle, plus what is `shadcn/tailwind.css`? | **live** — only local compile log; appendix is the `shadcn@4.18.0` `dist/tailwind.css` dump (keep intact) |
| [02-claim-audit.md](02-claim-audit.md) | Doc/changelog audit of 36 numbered claims plus extras | **live** for URL citations; several verdicts **superseded** by `05` and by later skill rewrites — do not copy old skill wording from here |
| [03-container-queries.md](03-container-queries.md) | Should the house style lean into `@container`, and what is the decision rule? | **live** — folded into `tailwind/references/gotchas.md` and the SKILL.md “don’t convert `md:`” line |
| [04-ui-collisions-salvage.md](04-ui-collisions-salvage.md) | Which UI-collisions log entries belong in this skill? | **live** for KEEP/DROP of C1–C8; C7 specificity write-up is **superseded** by the current `cleanup.md` `:where()` story, which itself has **no compile in this tree** (see CLAIMS.md) |
| [01-skill-best-practices.md](01-skill-best-practices.md) | Deltas vs current Agent Skills / Claude Code authoring guidance | **live** for packaging; earlier full checklist is `archive/research-agent-skills-authoring.md` |
| [06-state-specificity-compile.md](06-state-specificity-compile.md) | Does `hover:` really demote `data-active:`, and by what mechanism? | **live** — supersedes `04`'s C7; the `:where()` finding |
| [07-missing-token-compile.md](07-missing-token-compile.md) | What actually happens when a bridged token is missing? | **live** — silent in markup, exit 1 under `@apply`; also `--radius-xl` |
| [08-remaining-claims.md](08-remaining-claims.md) | The six claims docs could not settle, one method each | **live** — four verdicts changed the skill's wording |
| [09-trigger-eval-run.md](09-trigger-eval-run.md) | Does the description actually fire the skill, and is a shorter one worse? | **live** — four rounds on a corrected harness; negatives 40/40, positives 0.3 in an empty dir; 199→154 chars with no change in behaviour |
| [10-container-units-compile.md](10-container-units-compile.md) | Do `cqi`/`cqw`/`cqh` resolve, and does Tailwind warn? | **live** — evidence for the container-unit paragraph |

## Historical / rejected

| File | Question it answers | Status |
| --- | --- | --- |
| [archive/after.md](archive/after.md) | What a 2026-08-19 authoring-spec audit changed in the skill | **historical** — process log, not evidence for Tailwind facts |
| [archive/research-skill-structure.md](archive/research-skill-structure.md) | How comparable skills are laid out; why this one split into `references/` | **historical** — layout decisions; some size numbers predate later edits |
| [archive/research-agent-skills-authoring.md](archive/research-agent-skills-authoring.md) | Checkable authoring-spec rules with URLs | **historical** — `01` is the delta against *this* skill |
| [archive/research-canonical-classes.md](archive/research-canonical-classes.md) | What `canonicalizeCandidates` actually rewrites | **live** evidence behind the canonical table and editor.md ESLint options |
| [archive/research-upgrade-codemods.md](archive/research-upgrade-codemods.md) | Why not `@tailwindcss/upgrade` as a formatter on already-v4 code | **live** evidence behind editor.md’s “never the upgrade CLI” |
| [archive/research-cli-enforcement.md](archive/research-cli-enforcement.md) | Skills that shell out to a linter vs prose-only | **historical** — decision: no `scripts/`; use `eslint --fix` |
| [archive/research-utility-directive.md](archive/research-utility-directive.md) | `@utility` vs `@layer utilities` | **live** for that distinction; extra `@utility` authoring depth was **deliberately not** folded in (risk: inventing a parallel utility vocabulary) |
| [archive/research-color-rules.md](archive/research-color-rules.md) | Contrast-by-L, comma-`oklch()`, lower-C gamut advice | **live** evidence for the OKLCH house rules (with stated caveats) |
| [archive/oklch-research-fyi.md](archive/oklch-research-fyi.md) | OKLCH literacy from oklch.fyi / CSS Color 4 | **historical** background; colour *rules* live in `research-color-rules.md` |
| [archive/oklch-research-skill.md](archive/oklch-research-skill.md) | What to borrow from jakubkrehel/oklch-skill | **historical** — rejected palette-ramp / P3-fallback / invert-for-dark |
| [archive/findings-cursor-copy.md](archive/findings-cursor-copy.md) | Fact-check of the 12-rules candidate skill | **historical** — produced several KEEP rules and the “never `shadow-sm`→`shadow-xs`” guard |
| [archive/candidate-12rules.md](archive/candidate-12rules.md) | The 12-rules candidate itself | **historical** — rejected; Rule 9 would corrupt v4 code |
| [archive/findings-cursor-index.md](archive/findings-cursor-index.md) | Fact-check of the hairyf docs-index candidate | **historical** — salvage was `@custom-variant` vs `@variant` and `@md:` ≠ `md:` |
| [archive/candidate-hairyf-index.md](archive/candidate-hairyf-index.md) | The hairyf index dump | **historical** — rejected (~3.8k always-on tokens pointing at a stale snapshot) |

---

## Bug ledger (calibration)

This skill has shipped confidently-worded false claims. Treat that as the base rate. Current wording and evidence: [CLAIMS.md](CLAIMS.md) (rows marked **corrected**).

| Claim that shipped | Reality | How it was caught |
| --- | --- | --- |
| "`@apply` loses variants in v4" | A **v1** limitation, fixed in v2 | User challenged it; release notes |
| "`w-full w-32` → keep `w-32`" under auto-apply | `.w-32` emits before `.w-full`, so `w-full` wins | Compiled emission order (reconfirmed in `05`) |
| "`hsl(var(--x))` means v3-shaped, every `/opacity` is dead" | Only **bare channels** are dead; wrapped HSL is a complete colour | Compiled both shapes |
| "`padding: --spacing(6)`" as the zero-processing escape | Build-time function; hard-errors without a theme | CLI error in `05` |
| chroma ceiling "≤ 0.22" | Own scaffold `--destructive` is C **0.245** | Cross-read SKILL.md vs setup.md |
| "keep theme tokens opaque" with no exception | Scaffold ships `--border: oklch(1 0 0 / 10%)` | Same |
| `group-[]:` → `in-[.group]:` | `group-[]:` generates nothing | Compiled |
| "`@reference` OOMs at scale" | Fixed in 4.1.6, PR #17836 | Changelog (`02` claim 22) |
| "`size-*` is native in v4" | Shipped in v3.4 | Release history |
| v3 `@tailwind` trio "emits utilities, tokens just dead" | Exit 0, but only theme-independent utilities (`flex`); `p-4` / `bg-red-500` omitted entirely | `05` |
| `hsl(var(--x))` is "shadcn's prescribed v4 shape" | Current shadcn stores complete `oklch()` | `02` |
| Biome `"fix": "safe"` applies `useSortedClasses` | Fix is **unsafe** | `02` |
| Canonical rule only conflicts with `enforce-shorthand-classes` | Also important-position + variable-syntax | `02` |

**Pattern:** four early bugs were self-contradictions between the skill’s own files. Cross-read SKILL.md against `references/setup.md` before checking either against the docs.

## Decisions already made (don’t re-litigate without a reason)

| Decision | Rationale |
| --- | --- |
| One skill, two modes — not a separate cleanup skill | Cleanup needs the same token system |
| Authoring rules stay **in** SKILL.md | Pushing always-on rules to `references/` is how they silently stop applying |
| OKLCH-only tokens; no 50–950 ramp; no invert-for-dark | Matches shadcn + Tailwind palettes; roles are re-set under `.dark` |
| No `@supports` / P3 fallback ladder | `oklch()` is Baseline widely available since May 2023 |
| No `scripts/` | `eslint --fix` already enforces; don’t wrap a tool that exists |
| `enforce-canonical-classes` over `@tailwindcss/upgrade` | Upgrade CLI has no templates-only mode and skips `rem` so px rewrites don’t fire |
| Duplicate-property pairs are **flagged, never auto-fixed** | Emission order decides; `cn()` / tailwind-merge changes the answer again |
| No docs-index always-on catalogue | Evaluated `candidate-hairyf-index.md` and rejected it |
| `cn()` implementation and `cursor-pointer` are **asked, never assumed** | Project-taste calls |
| Container queries: decision rule, not a tutorial | `03` — viewport for page chrome, `@container` for slot-width components; do not restyle shadcn primitives |

## Where to be sceptical

1. Self-contradiction between skill files (highest yield).
2. A claim marked **compiled** in the skill that has no matching dump in `05-build-verification.md`.
3. Colour rules are simplifications: “fix contrast by moving L” is true at shadcn’s low chroma, not universally (`archive/research-color-rules.md`).
4. Time-stamped pins: `cnfast` v0.1.0; `next-themes` 0.4.6; shadcn 4.18.0; Tailwind 4.3.3.
5. Anything the trigger eval touches — `09` is one to two runs per variant where the spec asks for three, and its first pass was void to a stdin bug in the runner. Read the method section before citing a number.

## Known open

- The **no-evidence list is closed** — all ten rows settled, see the bottom of [CLAIMS.md](CLAIMS.md). Two claims remain *soft* (the `--spacing()` integer formula, `group`/`peer` markers); they have evidence that is stale or absent rather than contradictory.
- **Trigger rate.** `09` measures 0.3 positives / 40-of-40 negatives in an **empty directory**, and shows wording is not the lever — seven query shapes never fire under any variant. Nobody has run the eval inside a **real Tailwind project**, where the model has files and a `CLAUDE.md` to go on; that is the next measurement. A hook on Tailwind file edits is the untested way to raise it.
- Whether to teach more `@utility` authoring than “not `@layer utilities`” is still undecided (`archive/research-utility-directive.md`).
