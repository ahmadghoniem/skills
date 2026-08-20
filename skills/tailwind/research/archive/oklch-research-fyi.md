> **Archive pointer.** Same topic as [oklch-research-skill.md](oklch-research-skill.md) (third-party skill salvage) and [research-color-rules.md](research-color-rules.md) (the rules that actually shipped). This file is the oklch.fyi / CSS Color 4 literacy note. Not merged — different sources. Index: [README.md](README.md).

# OKLCH Research Report (for a Tailwind v4 + shadcn skill)

Research date: 2026-08-03  
Primary study site: [https://oklch.fyi/](https://oklch.fyi/)  
Purpose: (a) enforce OKLCH for every generated color token; (b) teach an agent the concrete benefits and gotchas of OKLCH so it can reason about palettes, contrast, and theming.

---

## 1. What OKLCH is

**OKLCH** (written `oklch()` in CSS) is the **cylindrical / polar form of the Oklab color space**. Oklab is a perceptually uniform Lab-like space designed by Björn Ottosson (2020); OKLCH keeps the same Lightness axis and re-expresses the opponent axes as **Chroma** and **Hue**. ([CSS Color Module Level 4](https://www.w3.org/TR/css-color-4/#ok-lab); [Oklab original post](https://bottosson.github.io/posts/oklab/); [oklch.fyi explainer](https://oklch.fyi/); [MDN `oklch()`](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch))

Syntax:

```css
oklch(L C H)
oklch(L C H / A)
```

| Axis | Meaning | Range (practical / CSS) | What it does |
| --- | --- | --- | --- |
| **L** (Lightness) | Perceived brightness | `0`–`1`, or `0%`–`100%` (`0`/`0%` = black, `1`/`100%` = white) | Moves along the black↔white axis without changing hue when C and H are held | 
| **C** (Chroma) | Colorfulness / distance from gray | Useful min `0` (gray); theoretically unbounded; in practice typically ≤ ~`0.4`–`0.5` depending on L, H, and gamut. In CSS, **`100%` ≡ `0.4`** for C | Controls intensity; higher C = more vivid |
| **H** (Hue) | Hue angle | `0`–`360` (or any `<angle>`; `0` and `360` are the same hue). Spec: `0deg` toward purplish red (positive *a*), `90deg` mustard yellow (positive *b*), `180deg` greenish cyan, `270deg` sky blue | Selects the color family |
| **A** (alpha, optional) | Opacity | `0`–`1` or `0%`–`100%`; defaults to fully opaque if omitted | Transparency; written after a **slash**: `oklch(0.7 0.1 250 / 50%)` |

Sources for ranges and alpha slash syntax: [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch), [CSS Color 4 §9.4](https://www.w3.org/TR/css-color-4/#ok-lab), [Evil Martians “OKLCH in CSS”](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl), [oklch.fyi Structure section](https://oklch.fyi/).

Notes an agent should internalize:

- **L in OKLCH ≠ L in HSL.** OKLCH L is *perceived* lightness; HSL L does not track visual brightness across hues. ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch); [CSS Color 4 on HSL vs OkLCh](https://www.w3.org/TR/css-color-4/); [Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl))
- Hue angles in OKLCH are **not** the same as HSL hue angles (e.g. sRGB red is ~`41deg` in OkLCh-related examples on MDN, not `0deg`). ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch))
- If C is `0`, hue is **powerless** (any H yields the same gray). ([CSS Color 4](https://www.w3.org/TR/css-color-4/#ok-lab))
- Relative color syntax (CSS Color 5): `oklch(from <color> L C H[/ A])` — useful for lighten/darken/hue-shift while staying in OKLCH. ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch); [Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl))

Minimal examples:

```css
oklch(0.45 0.26 264);   /* blue-ish */
oklch(1 0 0);           /* white */
oklch(0 0 0 / 50%);     /* black, 50% opacity */
```

([Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl))

---

## 2. Concrete benefits over hex / RGB / HSL

Each benefit → one-line “why it matters for a design system.”

| Benefit | Evidence | Why it matters for a DS |
| --- | --- | --- |
| **Perceptual uniformity** | Equal steps in L (and better spacing of hues) track how humans see; Oklab/OkLCh were optimized for lightness, chroma, and hue prediction. ([Oklab](https://bottosson.github.io/posts/oklab/); [CSS Color 4](https://www.w3.org/TR/css-color-4/#ok-lab); [oklch.fyi](https://oklch.fyi/)) | Scale steps (50→950) and cross-hue token sets look evenly weighted instead of “some steps jump.” |
| **Predictable lightness** | Same L across hues → same perceived brightness (oklch.fyi “Consistent brightness”; CSS Color 4: sRGB blue `oklch(0.452 …)` vs yellow `oklch(0.968 …)` correctly reflecting visual lightness, unlike HSL). ([oklch.fyi](https://oklch.fyi/); [CSS Color 4](https://www.w3.org/TR/css-color-4/)) | Semantic pairs (`primary` / `primary-foreground`) and multi-hue UI states can share L and stay visually matched. |
| **Wider gamut (Display P3 and beyond)** | Hex/`rgb()`/`hsl()` are sRGB; `oklch()` can encode P3 (and wider) colors. Modern Apple/OLED displays show ~30% more colors than sRGB in Evil Martians’ framing. ([Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl); [oklch.fyi “Color space support”](https://oklch.fyi/); [CSS Color 4](https://www.w3.org/TR/css-color-4/)) | Brand accents can use vivid P3 when available without abandoning a human-readable format. |
| **Better programmatic manipulation** | Change L to shade without hue/saturation drift; change H keeping L/C for “same weight, different color.” HSL lighten/darken and hue shifts produce unexpected lightness and a11y failures; LCH has a known blue→purple hue-shift bug that OKLCH was built to fix. ([oklch.fyi “Predictable shades”](https://oklch.fyi/); [Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl); [Oklab](https://bottosson.github.io/posts/oklab/)) | Agents/tools can generate ramps, hover states, and destructive variants from formulas instead of hand-picking every hex. |
| **Accessible contrast reasoning** | Because L tracks perceived brightness, contrast fixes are mostly “move L farther from the background”; Evil Martians note predictable lightness enables better a11y and even L-threshold heuristics for text color. ([Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl); [oklch-skill accessibility notes](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/accessibility-contrast.md)) | Theme tokens can be audited and repaired by adjusting one channel (L) instead of RGB trial-and-error. |
| **Human-readable vs hex/RGB** | `oklch(0.7 0.1 250)` communicates “mid-light, moderate chroma, blue”; `#6ea3db` does not. ([Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)) | Designers and agents can review diffs of tokens meaningfully. |

---

## 3. Gotchas / caveats

### Out-of-gamut values and clamping

- Not every `(L, C, H)` triple is displayable on sRGB or even P3. High C (e.g. `oklch(0.7 0.4 40)`) can be mathematically valid but outside real display gamuts; browsers **clip / gamut-map** to a nearby in-gamut color, which can look very different from the authored intent. ([oklch.fyi “Maximum chroma”](https://oklch.fyi/); [Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl); [CSS Color 4 gamut concepts](https://www.w3.org/TR/css-color-4/))
- **Prefer authoring within max chroma** for the chosen L, H, and target gamut (sRGB vs P3), rather than relying on the browser. ([oklch.fyi](https://oklch.fyi/); [Evil Martians gamut correction section](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl))
- CSS Color 4 specifies OKLCH-based gamut mapping; Evil Martians note some browsers historically used naive RGB clipping (hue can shift). Manual checks / `@media (color-gamut: p3)` dual values remain a practical pattern. ([CSS Color 4](https://www.w3.org/TR/css-color-4/#css-gamut-mapping); [Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl))

### Chroma unachievable at a given lightness

- Max C is an **irregular function of L and H**. At some lightnesses only certain hues reach high chroma; at extremes (near black/white) chroma collapses toward 0. ([oklch.fyi](https://oklch.fyi/); [Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl); [oklch-skill gamut notes](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/gamut-and-tailwind.md))
- Example framing from the companion skill docs: at L≈0.5 in sRGB, purple can reach C≈0.29 while cyan may only reach C≈0.09 — so **equal absolute C across hues ≠ equal vividness**. Use **% of max chroma** for multi-hue systems. ([palette-generation.md](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md); [gamut-and-tailwind.md](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/gamut-and-tailwind.md))

### sRGB vs Display P3 displays

- sRGB ⊂ P3 (approximately): every sRGB color has a P3 counterpart; P3 adds more saturated colors. ([oklch.fyi “Color space support”](https://oklch.fyi/); [Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl); [oklch-skill](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/gamut-and-tailwind.md))
- On an sRGB-only display, out-of-sRGB OKLCH colors are mapped inward and may look nearly identical to a more muted neighbor; on P3 they can appear more vivid. Grays (C≈0) look the same in both. ([oklch.fyi](https://oklch.fyi/))

### Browser support and fallbacks

- `oklch()` is in **CSS Color Module Level 4** and is **Baseline widely available** (MDN: across major browsers since May 2023). ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch); [oklch.fyi](https://oklch.fyi/); [CSS Color 4](https://www.w3.org/TR/css-color-4/))
- For very old clients, hex/`rgb` first + `@supports (color: oklch(0 0 0))` override is the pattern shown on oklch.fyi. That does **not** magically widen gamut for unsupported browsers — in-gamut OKLCH matches the equivalent hex. ([oklch.fyi “Browser support & fallbacks”](https://oklch.fyi/))

### Gradients

- Interpolating in OKLCH follows the hue circle and can take “detours” through unexpected hues; many tools prefer **Oklab** (straight-line) for smoother blends. ([oklch.fyi “Gradients”](https://oklch.fyi/); compare tool: [oklch.fyi/gradients](https://oklch.fyi/gradients))

### Authoring pitfalls for agents

- Do not copy HSL hue numbers into OKLCH and expect the same color. ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch))
- Do not assume `C: 0.3` is always “vivid” — it may be out of gamut or impossible for that L/H. ([oklch.fyi](https://oklch.fyi/))
- Alpha must use slash syntax (`/ a`), not legacy commas (`oklch()` has no comma form). ([CSS Color 4](https://www.w3.org/TR/css-color-4/#ok-lab))

---

## 4. How to generate a coherent OKLCH palette / ramp

### The technique (fixed hue, stepped lightness, chroma per step)

This is the method documented by the oklch.fyi companion skill ([palette-generation.md](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md)), which matches the Create tool’s Tailwind-like scale:

1. **Pick a base** — L, H, and a **chroma percentage** (not a raw C that you force at every step).
2. **Choose scale size** — Tailwind-style labels:
   - 5 steps: 100, 300, 500, 700, 900  
   - **9 steps (default):** 50, 100, 200, 300, 500, 700, 800, 900, 950  
   - 11 steps: 50…950 including 400/600  
3. **Set lightness bounds** around the base (skill algorithm):

   ```
   delta = 0.4
   minL = max(0.05, baseL - delta)
   maxL = min(0.95, baseL + delta)
   ```

   Clamp away from pure 0/1 so end stops can still carry chroma. ([palette-generation.md](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md))

4. **Distribute L evenly** from `maxL` (label 50, lightest) to `minL` (label 950, darkest).
5. **Per step, compute max chroma** for that `(L, H, colorSpace)` and set:

   ```
   C = (chromaPercentage / 100) * maxChroma(L, H, space)
   ```

   High-chroma brands naturally desaturate at the lightest/darkest ends — expected and correct. ([palette-generation.md](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md); [oklch.fyi max chroma concept](https://oklch.fyi/))

6. **Multi-hue systems:** reuse the **same L** and **same chroma %** across hues so perceived brightness and relative vividness match; absolute C will differ by hue. ([palette-generation.md](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md); [oklch.fyi consistent brightness](https://oklch.fyi/))

7. **Dark mode:** keep the ramp; remap semantic tokens (`bg` ↔ light/dark ends) rather than inventing a second unrelated palette. ([palette-generation.md](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md))

Why not HSL ramps: fixed HSL hue still **drifts** in perceptual hue as L changes; equal HSL L across hues is not equal brightness. ([palette-generation.md](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md); [oklch.fyi](https://oklch.fyi/); [Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl))

### What oklch.fyi does for this

On [https://oklch.fyi/create](https://oklch.fyi/create):

- Generate a palette from a **hex base** or live **L / C / H controls**
- Select **number of colors** (UI default **9**, Tailwind-style labels 50…950)
- Select **color space** (UI shows **sRGB**; paired Gamut Visualizer also models **Display P3**)
- Show each swatch with **copyable `oklch(...)`**
- **Contrast indicators** under swatches vs a comparison color (default `#000000`), surface type (e.g. Normal Text), algorithm (e.g. **WCAG 2**), with AA/AAA/Fail readouts
- **Copy CSS Variables** export
- **Save** (account / sign-in gated)

Observed Create UI behavior aligns with fixed-H ramps where **C falls off toward the lightest/darkest stops** while H stays constant — the max-chroma clamping pattern above. ([oklch.fyi/create](https://oklch.fyi/create); [palette-generation.md](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md))

---

## 5. What oklch.fyi offers as a tool

Site map explored (nav on [oklch.fyi](https://oklch.fyi/)):

| Surface | URL | Role |
| --- | --- | --- |
| **Explainer / home** | [oklch.fyi](https://oklch.fyi/) | Interactive teaching: models, gamut, L/C/H structure, consistent brightness vs HSL, predictable shades, gradients, P3 vs sRGB, max chroma, `@supports` fallbacks |
| **Create** | [/create](https://oklch.fyi/create) | Palette generator → CSS variables; contrast audit; sRGB (and related gamut tooling) |
| **Convert** | [/convert](https://oklch.fyi/convert) | Hex ↔ OKLCH converter + color picker; one-click copy of `oklch(...)` |
| **Bulk Convert** | [/bulk-convert](https://oklch.fyi/bulk-convert) | Paste entire CSS/config/file; convert all color values to OKLCH variables |
| **Gamut Visualizer** | [/gamut](https://oklch.fyi/gamut) | Hue-sliced view of **sRGB vs Display P3** boundaries with live `oklch` + hex |
| **Gradients** | [/gradients](https://oklch.fyi/gradients) | Compare OKLCH vs sRGB interpolation; edit stops; **Copy CSS** (`linear-gradient(in oklch …)`) |
| **Color Palettes** | [/color-palettes](https://oklch.fyi/color-palettes) | Gallery of OKLCH palettes (including Radix-named sets and user/custom) |
| **Saved** | [/saved](https://oklch.fyi/saved) | Persist created work (requires sign-in) |
| **OKLCH Skill** | [/skill](https://oklch.fyi/skill) | Agent skill install: `npx skills add jakubkrehel/oklch-skill` — convert, generate palettes, contrast, gamut clamp, fallbacks, Tailwind theming for Claude Code / Cursor / etc. |

### Why it’s useful for a shadcn / Tailwind workflow

1. **Output is already `oklch()` CSS variables** — the same form shadcn’s `:root` theme uses ([shadcn theming](https://ui.shadcn.com/docs/theming)).
2. **Tailwind-shaped 50–950 ramps** map cleanly into `@theme { --color-brand-* }` ([Tailwind colors docs](https://tailwindcss.com/docs/colors); [gamut-and-tailwind.md](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/gamut-and-tailwind.md)).
3. **Bulk Convert** is a migration path when converting hex/HSL themes into OKLCH for a house-style skill. ([bulk-convert](https://oklch.fyi/bulk-convert))
4. **Gamut Visualizer + Create color-space control** reduce accidental out-of-sRGB tokens before they land in `globals.css`. ([gamut](https://oklch.fyi/gamut); [create](https://oklch.fyi/create))
5. **Contrast readouts on the ramp** help pick which step becomes `primary` vs `muted-foreground`. ([create](https://oklch.fyi/create))
6. The **agent skill** encodes the same rules for automation inside the IDE. ([skill page](https://oklch.fyi/skill))

Related primary tooling often linked from the ecosystem (not oklch.fyi itself): Evil Martians’ [oklch.com](https://oklch.com/) picker, Huetone, etc. ([Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl))

---

## 6. How this maps to shadcn / Tailwind v4 tokens

### shadcn already speaks OKLCH

shadcn’s default theme scaffold stores semantic tokens as OKLCH in `:root` / `.dark`, then maps them into Tailwind via `@theme inline`:

```css
:root {
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  /* ... */
}

@theme inline {
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  /* ... */
}
```

([ui.shadcn.com/docs/theming](https://ui.shadcn.com/docs/theming))

Convention: **surface + `-foreground` pairs** (`background`/`foreground`, `primary`/`primary-foreground`, …). Components use `bg-primary text-primary-foreground`, not raw `bg-blue-500`. ([shadcn theming](https://ui.shadcn.com/docs/theming))

### Extending / theming while staying in OKLCH

1. Author new tokens only as `oklch(...)` under `:root` and `.dark`.
2. Expose them with `@theme inline { --color-*: var(--*); }` so utilities like `bg-warning` appear. ([shadcn “Adding New Tokens”](https://ui.shadcn.com/docs/theming))
3. For brand ramps used as primitives (optional), generate a 50–950 OKLCH scale (Create tool or algorithm in §4), then **point semantic tokens at chosen steps** (e.g. `--primary: var(--brand-600)` in light, a lighter step in `.dark`) — or assign explicit OKLCH values with shared H and controlled L gaps for contrast.
4. Prefer **adjusting L** to fix contrast; keep C/H for brand identity. ([accessibility-contrast.md](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/accessibility-contrast.md); [Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl))
5. If shipping P3-vivid accents, gate the higher-chroma OKLCH with `@media (color-gamut: p3)` and keep an sRGB-safe OKLCH outside. ([Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl); [gamut-and-tailwind.md](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/gamut-and-tailwind.md))

### Tailwind v4 specifics

- The **default Tailwind v4 palette is OKLCH**; the docs UI copies OKLCH values (shift-click for nearest hex). Example override style in the docs uses `oklch(...)` for `--color-gray-*`. ([tailwindcss.com/docs/colors](https://tailwindcss.com/docs/colors))
- Customize with CSS-first `@theme` / `@theme inline` under the `--color-*` namespace — not v3 `tailwind.config.js` color objects as the default path. ([Tailwind colors](https://tailwindcss.com/docs/colors))
- Opacity modifiers (`bg-sky-500/50`) compose with OKLCH as alpha on the color. ([Tailwind colors](https://tailwindcss.com/docs/colors); [gamut-and-tailwind.md](https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/gamut-and-tailwind.md))
- shadcn’s recommended path for apps is **semantic CSS variables** (`cssVariables: true`), with OKLCH values, layered on Tailwind v4 `@theme inline` — which is exactly the house style a Claude Code skill should enforce: **never emit new hex/hsl theme tokens when OKLCH is available**. ([shadcn theming](https://ui.shadcn.com/docs/theming))

### Skill enforcement checklist (derived from this research)

When generating or reviewing theme tokens:

1. Every color token value is `oklch(L C H)` or `oklch(L C H / A)` — not hex/rgb/hsl (except optional legacy `@supports` fallbacks).
2. Ramps: fixed H; stepped L; C ≤ max chroma for target gamut (prefer % of max).
3. Semantic pairs: sufficient **L distance** between surface and foreground; verify WCAG/APCA as required.
4. Multi-hue accents at the same role share L (and chroma %) so UI weight matches.
5. Document whether the token is sRGB-safe or P3-enhanced.

---

## Sources (index)

| Source | URL |
| --- | --- |
| oklch.fyi home / explainer | https://oklch.fyi/ |
| oklch.fyi Create | https://oklch.fyi/create |
| oklch.fyi Convert | https://oklch.fyi/convert |
| oklch.fyi Bulk Convert | https://oklch.fyi/bulk-convert |
| oklch.fyi Gamut Visualizer | https://oklch.fyi/gamut |
| oklch.fyi Gradients | https://oklch.fyi/gradients |
| oklch.fyi Color Palettes | https://oklch.fyi/color-palettes |
| oklch.fyi Skill | https://oklch.fyi/skill |
| oklch-skill palette generation | https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/palette-generation.md |
| oklch-skill gamut + Tailwind | https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/gamut-and-tailwind.md |
| oklch-skill contrast | https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/accessibility-contrast.md |
| oklch-skill SKILL.md | https://github.com/jakubkrehel/oklch-skill/blob/main/skills/oklch-skill/SKILL.md |
| CSS Color Module Level 4 | https://www.w3.org/TR/css-color-4/ |
| MDN `oklch()` | https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch |
| Evil Martians: OKLCH in CSS | https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl |
| Björn Ottosson: Oklab | https://bottosson.github.io/posts/oklab/ |
| shadcn theming | https://ui.shadcn.com/docs/theming |
| Tailwind CSS v4 colors | https://tailwindcss.com/docs/colors |

---

*No application code in this workspace was modified for this report.*
