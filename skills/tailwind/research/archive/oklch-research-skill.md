> **Archive pointer.** Same topic as [oklch-research-fyi.md](oklch-research-fyi.md) (colour-space literacy) and [research-color-rules.md](research-color-rules.md) (house-style fact check). This file is the jakubkrehel skill salvage. Not merged — different artefact. Index: [README.md](README.md).

# Research: jakubkrehel/oklch-skill — what to borrow for a Tailwind v4 + shadcn house style

**Source repo:** [https://github.com/jakubkrehel/oklch-skill](https://github.com/jakubkrehel/oklch-skill)  
**Reviewed tree (main, as of 2026-07-10 tip):** markdown-only skill — no scripts, no data tables, no code besides CSS examples inside `.md` files.  
**Files studied:**

| Path | Role |
| --- | --- |
| [`README.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/README.md) | Install blurb + action list |
| [`skills/oklch-skill/SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md) | Frontmatter, quick rules, mistakes, review format |
| [`skills/oklch-skill/color-conversion.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/color-conversion.md) | Hex/rgb/hsl → oklch conversion policy |
| [`skills/oklch-skill/palette-generation.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md) | Ramp algorithm, multi-hue, dark-mode flip |
| [`skills/oklch-skill/accessibility-contrast.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/accessibility-contrast.md) | APCA/WCAG, L-only contrast fixes |
| [`skills/oklch-skill/gamut-and-tailwind.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/gamut-and-tailwind.md) | P3, clamping, `@theme`, fallbacks |

**Judgment lens:** a Claude Code / Cursor skill whose primary job is Tailwind v4 + shadcn **semantic tokens** (`bg-background`, `text-muted-foreground`, `:root` / `.dark` oklch vars) — not building marketing palettes from scratch.

---

## 1. What this skill is and when it triggers

### Stated purpose

An agent skill for working in the OKLCH color space on web projects: convert colors, generate palettes, check contrast, handle gamut, and theme with Tailwind v4. The README positions it as a multi-action helper after `/oklch-skill` ([`README.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/README.md)).

### Frontmatter (triggers / description)

From [`skills/oklch-skill/SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md):

```yaml
name: oklch-skill
description: OKLCH color space for web projects. Convert hex/rgb/hsl to oklch, generate palettes, check contrast, handle gamut boundaries, and theme with Tailwind v4. Triggers on oklch, color conversion, palette generation, contrast ratio, gamut, display p3, design tokens, hue drift, chroma, dark mode colors.
```

### Scope

- **In scope:** OKLCH literacy, conversion hygiene, numeric scale generation (50–950), contrast heuristics (APCA-first), gamut/P3 fallback patterns, Tailwind v4 `@theme` chromatic scales.
- **Out of scope (implicit):** No React/component guidance, no shadcn semantic-token model, no class-list authoring rules, no lint tooling, no executable converters. Everything is prose + CSS snippets for the model to follow.
- **Packaging:** Agent Skills layout under `skills/oklch-skill/`; install via `npx skills add jakubkrehel/oklch-skill` ([`README.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/README.md)).

---

## 2. Concrete RULES / guidance about OKLCH

### How to pick L, C, H

| Channel | Guidance | Source |
| --- | --- | --- |
| **L** | `0–1`; perceptually uniform. Light bg when `L > 0.6` → dark text. Contrast fixes = move L only. | [`SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md), [`accessibility-contrast.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/accessibility-contrast.md) |
| **C** | `0–~0.4`; absolute colorfulness; max depends on L and H. Prefer **same C% of max** across hues, not same absolute C. Clamp C when out of gamut; keep L/H. | [`SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md), [`palette-generation.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md), [`gamut-and-tailwind.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/gamut-and-tailwind.md) |
| **H** | `0–360`; keep constant across a ramp. Hue spread **> 10°** across steps = visible drift. | [`SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md), [`accessibility-contrast.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/accessibility-contrast.md) |
| **Alpha** | Slash syntax only: `oklch(L C H / alpha)`; omit when `1`. | [`SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md), [`color-conversion.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/color-conversion.md) |

**Formatting rule:** L and C to 3 decimal places, H up to 3; drop trailing zeros; format `-0` as `0` ([`SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md)).

### Palette-ramp procedure

From [`palette-generation.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md):

1. Inputs: base `L`, **chroma percentage**, `H`.
2. `delta = 0.4`; `minL = max(0.05, baseL - delta)`; `maxL = min(0.95, baseL + delta)`.
3. Distribute L evenly from `maxL` (label 50) to `minL` (label 950).
4. Per step: `C = (chromaPercentage / 100) * findMaxChroma(L, hue, colorSpace)`.
5. Emit CSS vars `--color-50` … `--color-950` (or `--color-brand-*` in the Tailwind section).

Scale sizes: 5 / 9 / 11 steps; skill claims **“9 steps is the standard default (matches Tailwind)”** — see §5; that claim is wrong for Tailwind.

Dark mode: reverse mapping (`--color-bg: var(--color-50)` ↔ `.dark { --color-bg: var(--color-950) }`) ([`palette-generation.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md)).

### Do / don’t (lint-style)

Condensed from Common Mistakes + conversion rules ([`SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md), [`color-conversion.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/color-conversion.md)):

| Do | Don’t |
| --- | --- |
| Emit `oklch()` for new colors and Tailwind `@theme` | Leave hex/rgb/hsl in new code / `@theme` |
| Fix contrast by changing **L only** | Tweak chroma to “fix” contrast |
| Use same **C% of max** across hues | Copy one absolute C across hues |
| Clamp chroma for L/H/gamut | Ship high-C values without a gamut check |
| Keep constant hue on ramps | Rebuild HSL ramps that drift |
| Use slash alpha | Comma alpha |
| Convert color stops only | Rewrite gradient interpolation / CSS keywords / third-party hex configs |
| Present reviews as Before/After **tables** | Scatter Before:/After: prose lines |

**Key thresholds table** ([`SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md)):

- Light/dark boundary: `L > 0.6`
- Lightness gap (light bg): fg `L < 0.45` when bg `L > 0.85`
- Lightness gap (dark bg): fg `L > 0.75` when bg `L < 0.25`
- Hue drift: `> 10°`
- APCA normal text: `|Lc| >= 60` (pass), `>= 75` (pass+)
- WCAG 2 normal: `4.5:1` AA, `7:1` AAA

### Review output contract

Always a markdown table with Before | After for **every** changed color ([`SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md)).

---

## 3. Scripts, formulas, lookup tables

**There are none as runnable artifacts.** The recursive repo tree is only README + five markdown files under `skills/oklch-skill/`. No `scripts/`, no JS/TS, no JSON chroma tables, no contrast calculator.

What *is* bundled as **prose formulas / soft lookups**:

| Item | What it does | Limitation for an agent |
| --- | --- | --- |
| Ramp formula (`delta=0.4`, L clamp `[0.05,0.95]`, even L distribution) | Procedural 50–950 generator | Crude vs hand-tuned Tailwind scales; no code to run |
| `findMaxChroma(L, H, space)` | Named step only — “clamp C to max for L/H” | **Not implemented**; model must invent or use an external tool |
| Gamut anecdotes at L=0.5 | Purple ~0.29, red-orange ~0.20, cyan ~0.09 max C | Illustrative, not a table |
| Peak-hue shifts | Magenta peaks ~L=0.7, green ~L=0.9; cyan always lowest | Heuristic |
| APCA / WCAG threshold tables | Pass / Pass+ and AA / AAA cutoffs | No Lc calculator shipped |
| Lightness-gap shortcuts | Quick fg/bg L pairs | Explicitly “approximations — always verify” |
| CSS fallback recipes | sRGB base + `@media (color-gamut: p3)`; optional `@supports (color: oklch(...))` + hex | Patterns only |

README marketing (“converting colors, generating palettes, checking contrast…”) means **conversational skill actions**, not binaries ([`README.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/README.md)).

---

## 4. Opinions that are specific / non-obvious

1. **APCA over WCAG as default** — “Use APCA as the default”; WCAG only when making formal conformance claims ([`accessibility-contrast.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/accessibility-contrast.md)). Strong product opinion; many product teams still need WCAG numbers for legal/QA.

2. **Contrast = L distance; “chroma has negligible effect”** — always adjust L, never C ([`accessibility-contrast.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/accessibility-contrast.md)). Useful rule-of-thumb; slightly absolute (chroma can still matter at edges, but the agent directive is crisp).

3. **C% of max, not absolute C** — equal *relative* vividness across hues ([`palette-generation.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md)). This is the best non-obvious color-science rule in the skill.

4. **Hue drift > 10°** as a concrete lint threshold ([`SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md)).

5. **Dark mode = reverse the 50↔950 mapping** on the same ramp ([`palette-generation.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md)). Conflicts with shadcn’s model of **redefining semantic roles** under `.dark` (often different L *and* C, not a simple invert).

6. **P3 enhancement via `@media (color-gamut: p3)`** plus optional hex `@supports` ladder ([`gamut-and-tailwind.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/gamut-and-tailwind.md)). Progressive-enhancement opinion; shadcn/Tailwind defaults do not ship this stack.

7. **Token naming** — chromatic scales (`--color-brand-500`, `--color-50`), not semantic roles (`--primary`, `--muted-foreground`). Tailwind-aligned for *palette* work; shadcn-misaligned for *UI* work.

8. **“Never emit hex in new code / `@theme`”** — stricter than Tailwind itself (default theme still uses `#000` / `#fff` for black/white in theme CSS vars).

9. **Conversion minimalism** — convert values only; leave gradients’ interpolation, keywords, and third-party hex configs alone ([`color-conversion.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/color-conversion.md)).

10. **L as unitless 0–1** in examples — valid CSS; Tailwind’s own docs also show `oklch(98.4% …)` percentage form. Both work; skill standardizes on decimals.

---

## 5. Steal vs skip (for shadcn / Tailwind v4 semantic tokens)

### Steal (high value in a house-style skill)

| Borrow | Why it helps your skill |
| --- | --- |
| **Never raw hex/rgb/hsl in app/theme tokens — emit `oklch()`** | Matches shadcn globals and Tailwind v4 culture; kills `bg-[#…]` drift |
| **Slash alpha; omit alpha when 1** | Stops ugly `rgba` / comma-oklch |
| **Fix contrast by moving L; keep C/H** | Perfect for tuning `--foreground` vs `--background`, `--primary-foreground` vs `--primary` |
| **Same C% across related hues** (when you *do* author multi-hue accents/charts) | Prevents “red looks louder than blue” token sets |
| **Hue-drift > 10°** when migrating old HSL scales | Cheap audit rule |
| **Lightness-gap shortcuts + L>0.6 text polarity** | Fast sanity checks while editing `:root` / `.dark` |
| **Before/After table review format** | Paste-ready for “audit my tokens” skill mode |
| **Conversion leave-alone list** (keywords, third-party hex configs, gradient *functions*) | Stops over-eager agents from rewriting `currentColor` / library configs |
| **Gamut: clamp C, keep L/H** | One-liner when a brand accent is neon and clips |

### Steal with adaptation (don’t copy verbatim)

| Idea | Adapt for shadcn |
| --- | --- |
| Tailwind `@theme { --color-brand-* }` examples | Keep for optional **decorative** scales; primary UI should stay `--color-primary: var(--primary)` semantic bridge |
| APCA thresholds | Teach as optional; default checklist to **WCAG AA** unless the project opted into APCA |
| Gamut anecdotes (cyan is weak, etc.) | Fine as footnotes; don’t pretend they’re a full gamut solver |
| Formatting (3 dp L/C) | Align with whatever your existing shadcn snippet already uses |

### Skip / treat as noise or over-engineering

| Skip | Why |
| --- | --- |
| **Dark mode = flip 50↔950** | Wrong model for shadcn. You already redefine semantic vars under `.dark`. Blind invert produces muddy cards and wrong emphasis. |
| **Making 50–950 ramp generation the centerpiece** | Product UI lives on ~12 semantic roles, not 11 brand stops. Ramp algo is for design-system *palette* skills, not class authoring. |
| **`delta = 0.4` even-L algorithm** | Too coarse; real Tailwind scales are hand-tuned across ~0.98→0.13 and are not even L steps. Teaching this as “the” ramp will fight Tailwind’s own palettes. |
| **`findMaxChroma` without a tool** | Agents will hallucinate C. Either ship a script / point at culori/oklch.fyi, or say “stay conservative / copy known-good C from Tailwind stops.” |
| **Full `@supports` + hex + P3 media stack as default** | Skill itself cites Baseline 2023 / 96%+ oklch support. Tailwind v4 and shadcn ship oklch without hex ladders. P3 dual values are niche brand polish, not house-style defaults. |
| **“9 steps is the standard default (matches Tailwind)”** | **Wrong.** Tailwind’s default chromatic scales are **11** steps: 50,100,200,300,**400**,500,**600**,700,800,900,950 ([Tailwind colors docs](https://tailwindcss.com/docs/colors)). Their own 11-row table is correct; calling 9 the Tailwind default is outdated/incorrect. |
| **APCA-as-default for every agent run** | Noise in compliance-oriented apps; also the skill ships no Lc calculator, so “use APCA” often becomes theater. |
| **Numeric `--color-50` naming as the token convention** | Collides with / distracts from shadcn `--background`, `--muted-foreground`, etc. |

### Tailwind v4 accuracy notes

| Claim in skill | Verdict |
| --- | --- |
| Tailwind v4 default palette is oklch; custom themes should follow | **Correct** ([`gamut-and-tailwind.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/gamut-and-tailwind.md); Tailwind theme docs) |
| Opacity modifiers work: `bg-brand-500/50` → `oklch(... / 0.5)` | **Correct** |
| `@theme { --color-brand-500: oklch(...) }` unlocks utilities | **Correct** |
| Migrate by converting hex in `@theme` | **Correct**, and matches your house rule against arbitrary hex |
| Hex `@supports` fallbacks required for oklch | **Mostly outdated for greenfield Tailwind v4** — optional legacy hedge, not default practice |
| 9-step scale “matches Tailwind” | **Incorrect** — Tailwind uses 11 |
| L exclusively as `0–1` (never `%`) | **Incomplete** — CSS and Tailwind docs accept both; not wrong, just narrower |

### Bottom line for your skill

Borrow the **hygiene and contrast micro-rules** (oklch-only tokens, slash alpha, L-only contrast, C%, hue-drift lint, Before/After tables). Do **not** borrow the **palette-product** center of gravity (50–950 generation, invert-for-dark, P3/`@supports` ceremony). Your existing semantic-token ladder already solves the hard product problem; this skill is strongest as a **color math footnote**, not as a competing theme architecture.

---

## 6. Paste-ready short quotes

Well-phrased lines worth lifting (lightly) into a house-style skill:

> “OKLCH is a perceptually uniform color space where the numbers actually mean what you think they mean.”  
> — [`skills/oklch-skill/SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md)

> “Contrast fix: Adjust L only — chroma has negligible effect”  
> — Key Thresholds, [`skills/oklch-skill/SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md)

> “Chroma has negligible effect on contrast — always adjust L, never C.”  
> — [`skills/oklch-skill/accessibility-contrast.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/accessibility-contrast.md)

> “Same absolute C across hues → Same C% of each hue's max chroma”  
> — Review table / Common Mistakes, [`skills/oklch-skill/SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md)

> “Different hues have different max chroma at the same lightness. Using the same absolute C value across hues would make some appear more vivid than others.”  
> — [`skills/oklch-skill/palette-generation.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md)

> “If the hue spread is greater than 10°, the palette has visible drift”  
> — [`skills/oklch-skill/accessibility-contrast.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/accessibility-contrast.md)

> “When converting existing colors to oklch, convert the color values but leave everything else unchanged — don't change gradient interpolation, don't restructure the CSS.”  
> — [`skills/oklch-skill/color-conversion.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/color-conversion.md)

> “Always present color changes as a markdown table with **Before** and **After** columns. Include **every color that was changed** — not just a subset.”  
> — [`skills/oklch-skill/SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md)

> “Hex in Tailwind v4 `@theme` → Convert to oklch values”  
> — Common Mistakes, [`skills/oklch-skill/SKILL.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md)

> “The fix: reduce chroma while keeping L and H constant.”  
> — [`skills/oklch-skill/gamut-and-tailwind.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/gamut-and-tailwind.md)

> “Alpha uses the forward-slash syntax. Omit alpha when it's 1.”  
> — [`skills/oklch-skill/color-conversion.md`](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/color-conversion.md)

---

## Appendix: repo shape (what you are *not* missing)

```
oklch-skill/
  README.md
  skills/oklch-skill/
    SKILL.md
    accessibility-contrast.md
    color-conversion.md
    gamut-and-tailwind.md
    palette-generation.md
```

No other reference/rule files. No scripts. Depth is entirely in those five markdown docs at [https://github.com/jakubkrehel/oklch-skill](https://github.com/jakubkrehel/oklch-skill).
