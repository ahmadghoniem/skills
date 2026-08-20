> **Archive.** Instruction file for this consolidation. Not findings. Prior: [BRIEF.md](BRIEF.md), [BRIEF-2.md](BRIEF-2.md). Result: `research/README.md`, `research/CLAIMS.md`, this `archive/`.

# Research brief 3 — turn the loose notes into a usable provenance record

This is a **cleanup and consolidation** job, not new research. Do **NOT** edit anything under
`tailwind/` — that is the shipped skill and it is finished. You are only reorganising the
supporting notes so they work as provenance for the skill's claims.

## The problem

The repo root is littered with one-off notes from earlier sessions, and `research/` holds two
briefs plus five reports from this session. Together they are the evidence base for the skill,
but nobody can navigate them. A reader who asks "why does the skill say `ring` is 1px?" or
"where did the emission-order rule come from?" has no entry point.

## Current inventory

Root level (pre-existing, none of it ships with the skill):
- `after.md`
- `candidate-12rules.md`, `candidate-hairyf-index.md`
- `EVALUATION-CONTEXT.md`
- `findings-cursor-copy.md`, `findings-cursor-index.md`
- `oklch-research-fyi.md`, `oklch-research-skill.md`
- `research-agent-skills-authoring.md`, `research-canonical-classes.md`,
  `research-cli-enforcement.md`, `research-color-rules.md`, `research-skill-structure.md`,
  `research-upgrade-codemods.md`, `research-utility-directive.md`

`research/` (this session):
- `BRIEF.md`, `BRIEF-2.md`, `BRIEF-3.md` (this file)
- `01-skill-best-practices.md`
- `02-claim-audit.md` — 36 claims, verdicts, source URLs
- `03-container-queries.md`
- `04-ui-collisions-salvage.md`
- `05-build-verification.md` — real compiles on 4.3.3, plus a 630-line appendix

## What to produce

### 1. `research/README.md` — the entry point

A short index. For each surviving document: one line saying what question it answers and whether
its conclusions are **live** (reflected in the current skill), **superseded** (a later document
overturned it), or **historical** (context only, e.g. a rejected candidate skill).

Order by usefulness to someone auditing the skill, not chronologically.

### 2. `research/CLAIMS.md` — the provenance table

The single most valuable artifact. One row per load-bearing claim **currently in the skill**,
mapping it to its evidence:

| Claim (as stated in the skill) | File:line | Verdict | How verified | Source |

- Read the current `tailwind/SKILL.md` and `tailwind/references/*.md` to get the claims as they
  are worded **now** — several were rewritten after the audits, so do not copy the old wording
  out of `02-claim-audit.md`.
- "How verified" must distinguish **compiled** (someone ran Tailwind and read the output — see
  `05-build-verification.md`) from **documented** (a docs or changelog citation) from
  **unverified**.
- Include the claims that were found WRONG and then corrected, marked as corrected, with a
  pointer to what they used to say. That history is the point of the record.
- Flag any claim in the current skill that has **no** evidence behind it in any research file.
  That list is the most useful output of this whole exercise — do not pad it, but do not hide it
  either.

### 3. Consolidate the root-level notes

Move everything from the root inventory above into `research/archive/` and write
`research/archive/README.md` explaining, in one line each, what the file was and whether anything
in it still matters. Merge obvious duplicates (`oklch-research-fyi.md` vs
`oklch-research-skill.md`, the two `findings-cursor-*.md`, the two `candidate-*.md`) where they
cover the same ground — but **never delete a file outright**; if it is redundant, say so in the
archive README and keep it.

`EVALUATION-CONTEXT.md` is the exception: read it first, because it may already be a partial
index of the others. If it is, fold it into `research/README.md` rather than archiving it, and
note in the archive README that you did.

### 4. Fold in the briefs

`BRIEF.md`, `BRIEF-2.md` and `BRIEF-3.md` are instructions, not findings. Move them to
`research/archive/briefs/`. Do not delete them — they document what was and was not asked.

## Constraints

- **Never edit or delete anything under `tailwind/`.**
- Never delete a research file. Move, merge-with-a-pointer, or annotate — never `rm`.
- Do not do new web research. If a claim has no evidence, say so; do not go find some.
- Keep `05-build-verification.md`'s appendix intact — it is the only local copy of
  `shadcn@4.18.0/dist/tailwind.css`.
- Prefer fewer, better-named files over a deep tree. `research/` should be flat except for
  `archive/` and `archive/briefs/`.

## Report back

When done, print a short summary: the new tree, how many claims are in `CLAIMS.md`, how many are
compiled vs documented vs unverified, and the list of skill claims with no evidence behind them.
