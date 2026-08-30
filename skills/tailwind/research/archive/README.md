# Archive

Pre-session notes and the three research briefs. Nothing here was deleted; related files are linked, not concatenated.

`EVALUATION-CONTEXT.md` stayed at the **repo root** as a pointer. Its index, bug ledger, and decision table were folded into [../README.md](../README.md) rather than copied here.

## Briefs (`briefs/`)

| File | What it was | Still matters? |
| --- | --- | --- |
| [briefs/BRIEF.md](briefs/BRIEF.md) | Round 1 instructions: doc-audit 36 claims, container queries, UI-collisions salvage | Yes — shows what was asked; findings are `../01`–`04` |
| [briefs/BRIEF-2.md](briefs/BRIEF-2.md) | Round 2 instructions: compile the UNVERIFIED claims on 4.3.3 | Yes — method contract for `../05-build-verification.md` |
| [briefs/BRIEF-3.md](briefs/BRIEF-3.md) | This consolidation | Yes — documents the provenance-job constraints |

## Vendored source

| File | What it is |
| --- | --- |
| [shadcn-4.18.0-tailwind.css](shadcn-4.18.0-tailwind.css) | `shadcn@4.18.0` `dist/tailwind.css` verbatim, extracted out of `../05-build-verification.md` so it is greppable as CSS. Evidence for the `@custom-variant` definitions and the `:where()` wrapping compiled in `../06`. Reproduce with `npm pack shadcn@4.18.0`. |

## Files

| File | What it was | Still matters? |
| --- | --- | --- |
| [after.md](after.md) | 2026-08-19 authoring-spec audit log (what changed in the skill) | Historical process; not Tailwind-fact evidence |
| [research-agent-skills-authoring.md](research-agent-skills-authoring.md) | Full Agent Skills spec checklist with URLs | Background for `../01-skill-best-practices.md` |
| [research-skill-structure.md](research-skill-structure.md) | How comparable skills are laid out; why `references/` | Historical; some byte counts predate later edits |
| [research-canonical-classes.md](research-canonical-classes.md) | `canonicalizeCandidates` rewrite pairs, collapse/`rem` | **Yes** — canonical table + editor.md options |
| [research-upgrade-codemods.md](research-upgrade-codemods.md) | `@tailwindcss/upgrade` is not a templates-only formatter | **Yes** — editor.md “never the upgrade CLI” |
| [research-cli-enforcement.md](research-cli-enforcement.md) | Skills that shell out to a linter | Decision record: no `scripts/` |
| [research-utility-directive.md](research-utility-directive.md) | `@utility` vs `@layer utilities`, plus extra authoring | **Yes** for the distinction; extra depth not shipped |
| [research-color-rules.md](research-color-rules.md) | Contrast-by-L, comma-`oklch()`, lower-C gamut | **Yes** — OKLCH house rules |
| [oklch-research-fyi.md](oklch-research-fyi.md) | OKLCH literacy from oklch.fyi / CSS Color 4 | Background; rules live in `research-color-rules.md` |
| [oklch-research-skill.md](oklch-research-skill.md) | Salvage of jakubkrehel/oklch-skill | Historical reject of ramps / P3 / invert-for-dark |
| [candidate-12rules.md](candidate-12rules.md) | **Stub.** Third-party 12-rules skill; text removed, Rule 9 kept verbatim as the negative example (`shadow-sm`→`shadow-xs`) | Historical reject |
| [findings-cursor-copy.md](findings-cursor-copy.md) | Fact-check of that 12-rules skill | Historical; several KEEP rules shipped |
| [candidate-hairyf-index.md](candidate-hairyf-index.md) | **Stub.** Points at <https://github.com/hairyf/skills>; dump removed | Historical reject (stale always-on catalogue) |
| [findings-cursor-index.md](findings-cursor-index.md) | Fact-check of the hairyf index | Historical; salvage was `@custom-variant` vs `@variant` and `@md:` ≠ `md:` |

OKLCH trio and the two candidate/evaluation pairs cover related ground but not the same artefact, so they were **not** concatenated. Each file has a pointer to its siblings.
