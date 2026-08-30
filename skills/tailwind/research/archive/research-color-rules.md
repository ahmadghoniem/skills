> **Archive pointer.** The load-bearing OKLCH rules. Background: [oklch-research-fyi.md](oklch-research-fyi.md), [oklch-research-skill.md](oklch-research-skill.md). Current mapping: [../CLAIMS.md](../CLAIMS.md).

# OKLCH house-style rules — fact check

Research date: 2026-08-18. Narrow use: AI-authored shadcn semantic tokens (≈12 roles, light + dark), Tailwind v4.

**Verified** = quoted from a spec/docs/source. **Computed** = numbers from Ottosson’s published Oklab matrices this session. **Inferred** = not live-tested in a browser.

---

## Rule 1 — “Fix contrast by moving L only; never touch C or H.”

**Verdict: true-with-caveats.** “Negligible” is fair for typical shadcn chroma (C ≈ 0–0.08). It is an oversimplification for vivid accents.

OKLCH **L** is *perceived lightness* (how light it looks). WCAG **relative luminance Y** is *how much light*, computed from linearized sRGB: `Y = 0.2126 R + 0.7152 G + 0.0722 B`, then ratio `(Ylighter + 0.05) / (Ydarker + 0.05)`. They are not the same number. For greys, `Y = L³` exactly (**computed**; matches Ottosson). Off-grey, holding L and raising C still moves Y because Oklab is compensating for chroma looking brighter than its luminance (Helmholtz–Kohlrausch). APCA **Lc** also starts from RGB (not from OKLCH L), so C moves Lc too — but APCA’s own docs say hue/chroma are not what make text readable; lightness contrast is. ([WCAG 2.2 relative luminance](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance); [WCAG Understanding 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html); [APCA easy intro](https://git.apcacontrast.com/documentation/APCAeasyIntro.html); [Ottosson Oklab](https://bottosson.github.io/posts/oklab/); [CSS Color 4: sRGB blue `oklch(0.452…)` vs yellow `oklch(0.968…)`](https://www.w3.org/TR/css-color-4/#ok-lab))

**Computed, L fixed at 0.62, in-gamut only, vs white:** grey is 3.64:1. Max-chroma red/purple ≈ 4.1:1 (C *helps* WCAG). Max-chroma green ≈ 3.37:1 (C *hurts* WCAG). APCA Lc vs white moved about 2–3 points in the same set. Near a 4.5:1 or Lc 60 cutoff, that can flip a pass. At C = 0.05 (muted UI), the WCAG move was ~0.01–0.08. So: L is the lever; C is not “zero”; don’t tune C to chase contrast.

**L-only is not enough when:**

- The pair is already near a WCAG/APCA threshold and one colour is high-chroma green/cyan (C can drop the measured ratio).
- The colour is out of gamut: the browser maps/clips it, so the L you typed is not the L that displays.
- The token has alpha, or sits on a mixed/gradient/image background — displayed lightness is not the token’s L.
- Saturated light text on dark: WCAG can *overstate* contrast (chroma doesn’t add readability). Lower C, don’t raise it.
- WCAG’s own advisory: strong red on black is a problem for protanopia; hue then matters.

**Skill one-liner:** To fix contrast, move L farther from the background and leave C and H; then re-check the ratio — do not raise C to “add contrast.”

---

## Rule 2 — “Alpha uses slash syntax only: `oklch(L C H / A)`. The comma form is invalid CSS.”

**Verdict: true.**

`oklch()` grammar is space-separated L C H, optional `/` alpha. Comma form is the old **legacy color syntax**. Spec: *“`oklab()` and `oklch()` do not support a legacy color syntax that separates all of their arguments with commas. Using commas inside these functions is an error.”* Same rule for all Color-4-new functions. Invalid value → the declaration is dropped; the previous/initial colour wins. (**Verified:** [CSS Color 4 `oklch()`](https://www.w3.org/TR/css-color-4/#specifying-oklab-oklch), [legacy syntax](https://www.w3.org/TR/css-color-4/#legacy-color-syntax), [MDN `oklch()`](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch), [MDN CSS error handling](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_syntax/Error_handling).) **Inferred:** no current engine is documented as accepting comma-`oklch()`; WPT treats extra/non-slash components as invalid. Not live-fuzzed here.

Alpha may be a **number** (`/ 0.5`) or a **percentage** (`/ 50%`). Omit alpha when it is 1 / 100% — that is the default. (**Verified:** [`<alpha-value> = <number> | <percentage>`](https://www.w3.org/TR/css-color-4/#alpha-syntax); MDN: if A is omitted it defaults to 100%.)

**Tailwind v4 `/30`:** the opacity modifier does **not** rewrite the token to `oklch(L C H / 0.3)`. `--alpha(var(--color-lime-300) / 50%)` compiles to `color-mix(in oklab, var(--color-lime-300) 50%, transparent)`. `bg-sky-500/30` is the same mechanism. (**Verified:** [Tailwind `--alpha()`](https://tailwindcss.com/docs/functions-and-directives), [Tailwind colors / opacity](https://tailwindcss.com/docs/colors).) If the token already has `/ A`, `/30` fades an already-transparent colour (double fade). Keep theme tokens opaque; put transparency on the utility.

**Skill one-liner:** Write `oklch(L C H)` or `oklch(L C H / 0.5)` — spaces, slash for alpha, never commas; omit `/ 1`; keep `:root` / `.dark` tokens opaque and use `bg-primary/30`.

---

## Rule 3 — “If a colour is out of gamut, lower C and keep L and H.”

**Verdict: true-with-caveats** as *authoring* advice. It matches what CSS *asks* browsers to do, not what they all *do* yet.

**Spec (Aug 2026 CRD):** [Gamut Mapping](https://www.w3.org/TR/css-color-4/#gamut-mapping) → [CSS Gamut Mapping to an RGB Destination](https://www.w3.org/TR/css-color-4/#css-gamut-mapping). All three allowed algorithms “aim at constant-lightness, constant-hue chroma reduction in the OkLCh color space.” The original one is [Binary Search with Local MINDE](https://www.w3.org/TR/css-color-4/#GMA-Binary-local-MINDE): convert to OKLCH, binary-search C down, hold L and H; at each step if a channel-clipped copy is within **ΔEOK JND 0.02**, return the clip (tiny L/H wiggle allowed). L ≥ 1 → white; L ≤ 0 → black. Also allowed: EdgeSeeker, Ray Trace. Clip-RGB is specified as the *bad* method (hue can jump tens of degrees).

**Browsers as of 2026-08 (verified from engine notes, not a live matrix):**

| Engine | What actually runs |
| --- | --- |
| **Firefox 153+** | Algorithms exist; pref `layout.css.gamut-mapping.method`: **0 = channel clip (default)**, 1 = binary-search MINDE, 2 = raytrace. ([bug 1847503](https://bugzilla.mozilla.org/show_bug.cgi?id=1847503), [pref diff](https://cat-in-136.github.io/2026/06/diff-between-firefox-1530-beta-2-default.html)) |
| **WebKit** | Shipped CSS GMA, then **removed it (2025-11)** — “for now, we always clip.” ([commit](https://github.com/WebKit/WebKit/commit/b5db2ff0504dac4f5725e8af42b6284e40d635f1)) |
| **Chromium** | Still associated with clip / not-yet-default CSS GMA; CSSWG still picking among three algorithms ([csswg #10579](https://github.com/w3c/csswg-drafts/issues/10579)). |

So: **author as if C will be reduced and L/H held. Do not rely on the browser to do that.** Naive clip can hue-shift (spec example: 265° → 196°).

**How does a dev know it’s out of gamut without a tool?** They don’t, not from the three numbers. C has no fixed max; the sRGB roof is a lumpy function of L and H. Heuristics only: C ≳ 0.37 is never sRGB; near black/white almost no C survives; cyan is a weak hue. Otherwise convert (or use [oklch.com](https://oklch.com/), [color.js `inGamut`](https://colorjs.io/docs/gamut-mapping)). For this skill: stay conservative and copy C from known-good tokens (shadcn / Tailwind stops), don’t invent C = 0.3 at L = 0.9.

**sRGB max C (**computed**, Ottosson 2021-01-25 matrices; in-gamut = linear RGB in 0–1). Varies by hue — this is a sketch, not a law.**

| L | red 30° | yellow 110° | green 145° | cyan 195° | blue 264° | purple 300° |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.20 | 0.08 | 0.04 | 0.06 | 0.03 | 0.12 | 0.11 |
| 0.50 | 0.20 | 0.11 | 0.16 | 0.09 | 0.28 | 0.27 |
| 0.62 | 0.25 | 0.14 | 0.20 | 0.11 | 0.20 | 0.24 |
| 0.90 | 0.05 | 0.20 | 0.20 | 0.15 | 0.05 | 0.06 |

UI tokens: C ≤ 0.04 greys, C ≤ 0.12 most accents, C ≤ 0.22 only mid-L vivid (destructive/charts). `C` as `100%` means 0.4, which is almost always out of sRGB.

**Skill one-liner:** If it won’t fit sRGB, lower C and keep L and H — don’t wait for the browser; it may still clip and shift hue.

---

## Which of the three will an agent break first?

**Rule 2.** Models are soaked in `rgb(r, g, b)` / `rgba(..., 0.5)` commas. One comma in `oklch()` drops the whole token; the UI silently uses the wrong colour. Rule 3 is the usual *visual* miss (C = 0.3–0.4). Rule 1 is the one they ignore when contrast fails and they “saturate it.”

**Prevention:** `oklch()` never takes commas; alpha is `/ 0.5` or omitted; theme tokens stay opaque.

---

## Fourth rule (this use case)

**Opaque fill / foreground pairs, sized by L.** shadcn’s contract is `--primary` + `--primary-foreground` (and the same for background, card, muted, …). Keep both fully opaque. Put the L gap in the pair (then verify 4.5:1). Fade with `bg-primary/30`, not with `/ A` inside the token. Don’t invert a 50–950 ramp for `.dark` — re-set the same semantic roles.

That is the actual token job. The three colour-science rules don’t state it, and agents skip it constantly.

**Skill one-liner:** Every fill token has a paired `-foreground`; both are opaque `oklch(L C H)`; contrast is an L gap, transparency is a Tailwind `/n` utility.

---

## Sources

- CSS Color 4 (CRD 2026-08-06): https://www.w3.org/TR/css-color-4/ — [oklch grammar](https://www.w3.org/TR/css-color-4/#specifying-oklab-oklch), [legacy syntax](https://www.w3.org/TR/css-color-4/#legacy-color-syntax), [alpha](https://www.w3.org/TR/css-color-4/#alpha-syntax), [gamut mapping](https://www.w3.org/TR/css-color-4/#gamut-mapping), [CSS GMA](https://www.w3.org/TR/css-color-4/#css-gamut-mapping), [binary-search MINDE](https://www.w3.org/TR/css-color-4/#GMA-Binary-local-MINDE)
- MDN `oklch()`: https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch
- MDN CSS error handling: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_syntax/Error_handling
- WCAG 2.2 relative luminance / contrast: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance · https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- APCA: https://git.apcacontrast.com/documentation/APCAeasyIntro.html
- Ottosson Oklab: https://bottosson.github.io/posts/oklab/
- Tailwind v4 colors / `--alpha()`: https://tailwindcss.com/docs/colors · https://tailwindcss.com/docs/functions-and-directives
- shadcn theming: https://ui.shadcn.com/docs/theming
- Firefox GMA: https://bugzilla.mozilla.org/show_bug.cgi?id=1847503
- WebKit clip default: https://github.com/WebKit/WebKit/commit/b5db2ff0504dac4f5725e8af42b6284e40d635f1
- Color.js gamut mapping: https://colorjs.io/docs/gamut-mapping
