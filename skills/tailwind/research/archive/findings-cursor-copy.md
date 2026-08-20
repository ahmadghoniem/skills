> **Archive pointer.** Evaluation of [candidate-12rules.md](candidate-12rules.md). Not a duplicate of [findings-cursor-index.md](findings-cursor-index.md) (that one audits the hairyf index). Index: [README.md](README.md).

# Fact-check: candidate Tailwind v4 skill (`tailwindcss - Copy.md`) vs ours vs real v4 docs

Checked 2026-08-18 against Tailwind v4 docs (`tailwindcss.com/docs`, copyright 2026), the v4.0 blog (2025-01-22), and `tailwindlabs/tailwindcss` source. Every claim is **VERIFIED** (URL or repo path) unless marked **INFERRED**.

Legend: **A** already in ours · **B** correct + missing from ours · **C** wrong/stale/misleading · **D** real fact, bad agent rule.

---

## 1. Verdict table

### Critical Rules

| # | Candidate rule | Class | One-line reason |
| --- | --- | --- | --- |
| 1 | `@import "tailwindcss"` instead of `@tailwind` | **A** | Covered in `references/setup.md`. Docs: [upgrade-guide § Removed @tailwind directives](https://tailwindcss.com/docs/upgrade-guide). |
| 2 | CSS-first `@theme` (not `tailwind.config.js`) | **A** | Covered in `SKILL.md` + `setup.md`. The `--spacing-18: 4.5rem` example inside it is **C** (see §3). |
| 3 | `@tailwindcss/postcss`; drop `postcss-import` + `autoprefixer` | **B** | True ([upgrade-guide § Using PostCSS](https://tailwindcss.com/docs/upgrade-guide), [compatibility](https://tailwindcss.com/docs/compatibility)). We never document the PostCSS file. Lightning CSS nuance in §3. |
| 4 | Slash opacity; `bg-opacity-*` removed | **A** | `SKILL.md` colour ladder + `gotchas.md` (`color-mix`). [upgrade-guide § Removed deprecated utilities](https://tailwindcss.com/docs/upgrade-guide). |
| 5 | Custom colours in `@theme`; arbitrary hex “should be rare” | **A** / conflict | Intent matches our ladder. The HEX `@theme` sample **must not** be copied — our house style is OKLCH-only. |
| 6 | Container queries; labels `md:flex-row flex-col` as Wrong | **D** | `@container`/`@md:` exist ([responsive-design § Container queries](https://tailwindcss.com/docs/responsive-design)). Viewport `md:` is still the documented page-layout default. |
| 7 | `@utility` instead of `@layer utilities` | **B** | True, and we never mention `@utility`. [upgrade-guide § Adding custom utilities](https://tailwindcss.com/docs/upgrade-guide); `@layer utilities` no longer registers variant-aware utilities ([#14058](https://github.com/tailwindlabs/tailwindcss/issues/14058)). |
| 8 | `@import "tailwindcss" important;` | **D** | Syntax is real ([styling-with-utility-classes § important flag](https://tailwindcss.com/docs/styling-with-utility-classes)). As a Critical Rule it will `!important` an entire design system. |
| 9 | “Renamed utilities”: `shadow-sm`/`blur-sm`/`rounded-sm` are Wrong → write `-xs` | **D** (will corrupt v4 code) | Those `-sm` classes are valid v4 utilities. This is a v3→v4 *migration* map, not an authoring rule. Same trap we already guard against in `SKILL.md` / `cleanup.md`. |
| 10 | `bg-linear-to-*` not `bg-gradient-to-*` | **A** | Canonical table in `SKILL.md`. Authoring preference is right; “NEVER use `bg-gradient-to-*`” is **D** (legacy alias still generates CSS). |
| 11 | `not-*`; Wrong = `hover:bg-blue-500` “no way to style non-hovered” | **D** (+ framing is **C**) | `not-*` exists. The Wrong comment is false; the Correct example is a verbose restatement of `opacity-75 hover:opacity-100`. |
| 12 | `starting:opacity-0` for entry animations | **D** | Variant name `starting` is real (`@starting-style`). The example is not how the docs use it, and as a Critical Rule agents will sprinkle it on static divs. |

### Patterns

| Pattern | Class | One-line reason |
| --- | --- | --- |
| Define tokens in `@theme` | **A** | `SKILL.md` + `setup.md`. |
| `@import "tailwindcss"` as entry | **A** | `setup.md`. |
| Container queries for *component-level* responsive | **B** | Correct capability; we never mention `@container` / `@md:`. Unlike Rule 6, this line does not ban viewport `md:`. |
| Slash opacity `bg-blue-500/50` | **A** | `SKILL.md` / `gotchas.md`. |
| `@utility` for utilities, **`@variant` for custom variants** | **C** | `@utility` half is true (Rule 7). `@variant` does **not** define variants — that is `@custom-variant`. Beta leftover. |
| `bg-linear-to-*` not `bg-gradient-to-*` | **A** | `SKILL.md` canonical table. |

### Anti-Patterns

| Anti-pattern | Class | One-line reason |
| --- | --- | --- |
| NEVER `tailwind.config.js` unless JS dynamic config | **A** (gap: `@config`) | Matches our hard rule. Missing: how a JS file is actually loaded. |
| NEVER `@tailwind base/components/utilities` | **A** | `setup.md`. |
| NEVER `bg-opacity-*` / `text-opacity-*` | **A** | `gotchas.md` / colour ladder. |
| NEVER `@layer utilities` for custom utilities — use `@utility` | **B** | Same fact as Rule 7; we don't say this. |
| NEVER `bg-gradient-to-*` | **D** | Still registered as a legacy utility in source. Prefer `bg-linear-to-*` when *writing*; don't rewrite working classes as if they were invalid. |
| NEVER `postcss-import` or `autoprefixer` with v4 | **B** | Same as Rule 3. True for the PostCSS plugin graph; see Lightning CSS nuance. |
| NEVER `shadow-sm` when you mean the smallest shadow | **D** | Identical to Rule 9. On v4-native code `shadow-sm` is the named default shadow, **not** the smallest. |

---

## 2. SALVAGE (category B only)

Drop-in prose. Do not copy the candidate's Wrong/Correct pairs.

### `references/setup.md` — PostCSS (and Vite)

When the project uses PostCSS, the v4 plugin is `@tailwindcss/postcss`, not `tailwindcss`. Imports and vendor prefixes are handled inside Tailwind (Lightning CSS). A v4 PostCSS file is:

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

Do not add `postcss-import` or `autoprefixer` alongside it — [upgrade guide](https://tailwindcss.com/docs/upgrade-guide). If the project is Vite, prefer `@tailwindcss/vite` instead of PostCSS ([upgrade-guide § Using Vite](https://tailwindcss.com/docs/upgrade-guide)). Tailwind v4 targets Chrome 111 / Safari 16.4 / Firefox 128; prefixes are for those browsers, not IE-era targets. Need older browsers → stay on v3.4 ([compatibility](https://tailwindcss.com/docs/compatibility)).

### `SKILL.md` Canonical syntax (or a short “custom CSS” note) — `@utility`

Custom utilities that must work with `hover:` / `lg:` are declared with `@utility`, not `@layer utilities`. v4 uses native cascade layers and no longer hijacks `@layer` to register variant-aware utilities ([upgrade-guide](https://tailwindcss.com/docs/upgrade-guide), [docs/adding-custom-styles](https://tailwindcss.com/docs/adding-custom-styles)):

```css
@utility content-auto {
  content-visibility: auto;
}
```

`@layer utilities { .content-auto { … } }` still emits a static class; `hover:content-auto` will not exist.

### `SKILL.md` Authoring rules — numbered spacing is already dynamic

Do not add `--spacing-18: 4.5rem` (or any numbered `--spacing-N` that is a multiple of the unit) to `@theme`. v4 derives spacing from a single `--spacing` (default `0.25rem`): `p-18` / `w-18` compile to `calc(var(--spacing) * 18)` with no extra token ([v4 blog — Dynamic utility values](https://tailwindcss.com/blog/tailwindcss-v4), [padding docs](https://tailwindcss.com/docs/padding)). Named keys (`--spacing-gutter`) are for *names*, not for filling holes in the old 3/4/5/6… scale.

### `references/setup.md` (one line) — loading a JS config

A `tailwind.config.js` is not auto-detected in v4. If a project genuinely still needs one (legacy JS plugins/presets during migration), load it explicitly:

```css
@config "../../tailwind.config.js";
```

`corePlugins`, `safelist`, and `separator` from that file are ignored; safelist via `@source inline(…)` ([functions-and-directives § @config](https://tailwindcss.com/docs/functions-and-directives), [upgrade-guide § Using a JavaScript config file](https://tailwindcss.com/docs/upgrade-guide)). Prefer `@plugin "@tailwindcss/typography"` over a config file for JS plugins.

### `SKILL.md` Canonical syntax — container queries (capability, not default)

v4 has built-in container queries: `@container` on a parent, `@sm:` / `@md:` / `@max-md:` on children, driven by `--container-*` ([responsive-design](https://tailwindcss.com/docs/responsive-design)). Use them when a component must respond to **its parent’s width**. Viewport `sm:`/`md:`/`lg:` remain the correct tool for page layout. Do not rewrite `md:flex-row` into `@md:flex-row`.

### `references/gotchas.md` — `important: true` equivalent (do not default this)

v3 `important: true` is:

```css
@import "tailwindcss" important;
```

That marks **every** utility `!important`. Do not add it unless the project is fighting high-specificity legacy CSS. Per-class remains the suffix marker (`mt-4!`). Selector-scoped important (`important: '#app'`) is a different pattern (`#app { @tailwind utilities; }`) — [styling-with-utility-classes](https://tailwindcss.com/docs/styling-with-utility-classes), [important.test.ts](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/important.test.ts).

---

## 3. CANDIDATE IS WRONG

### Suspect 1 — Rule 9 + Anti-Pattern `shadow-sm` — CONFIRMED harmful

**VERIFIED.** In v4, `shadow-sm`, `blur-sm`, and `rounded-sm` are documented, named utilities — not mistakes.

| Class | v4 value (docs) |
| --- | --- |
| `shadow-xs` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` — smallest named |
| `shadow-sm` | `0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)` — default named |
| `rounded-xs` | `--radius-xs` / 0.125rem |
| `rounded-sm` | `--radius-sm` / 0.25rem |
| `blur-xs` | 4px |
| `blur-sm` | 8px |

Sources: [box-shadow](https://tailwindcss.com/docs/box-shadow), [border-radius](https://tailwindcss.com/docs/border-radius), [filter-blur](https://tailwindcss.com/docs/filter-blur). Current docs still demo `blur-sm` ([styling-with-utility-classes](https://tailwindcss.com/docs/styling-with-utility-classes)).

The candidate copied the **v3→v4 upgrade map** ([upgrade-guide § Renamed utilities](https://tailwindcss.com/docs/upgrade-guide)):

> v3 `shadow-sm` → v4 `shadow-xs`; v3 `shadow` → v4 `shadow-sm`
> “The bare versions still work for backward compatibility, but the `-sm` utilities will look different unless updated to their respective `-xs` versions.”

That paragraph is for **migrating v3 templates**. On already-v4 code, `shadow-sm` *means* v4’s `--shadow-sm`. An agent following Rule 9 will rewrite `shadow-sm` → `shadow-xs` and shrink every shadow/radius/blur by one scale step.

**Yes: this rule will corrupt correct v4 code.** Same for the Anti-Pattern. Our `SKILL.md` / `cleanup.md` “do not over-correct” block exists to stop the inverse of this exact trap.

### Suspect 2 — `@variant` vs `@custom-variant` — CONFIRMED wrong

**VERIFIED.** `@variant` applies an *existing* variant inside custom CSS. `@custom-variant` *defines* a new one.

```css
/* apply a variant in CSS — NOT a definition */
.my-element {
  @variant dark { background: black; }
}

/* define a variant */
@custom-variant theme-midnight (&:where([data-theme="midnight"] *));
```

Sources: [functions-and-directives](https://tailwindcss.com/docs/functions-and-directives), [adding-custom-styles § Using variants / Adding custom variants](https://tailwindcss.com/docs/adding-custom-styles). Rename: v4.0.0-beta.10 / [PR #15663](https://github.com/tailwindlabs/tailwindcss/pull/15663) (“Rename `@variant` to `@custom-variant`” for registration; new `@variant` for use-in-CSS). The candidate’s Pattern line is leftover from [v4-beta docs](https://v3.tailwindcss.com/docs/v4-beta), which still show `@variant pointer-coarse (…)` as a definition. We already use `@custom-variant` correctly in `setup.md`.

### Suspect 3 — Rule 11 `not-*` — framing is false; example is pointless

**VERIFIED.** `not-*` exists ([hover-focus-and-other-states § :not()](https://tailwindcss.com/docs/hover-focus-and-other-states), [v4 blog](https://tailwindcss.com/blog/tailwindcss-v4)). Official usage is stacking, e.g. `hover:not-focus:bg-indigo-700` (hover styles only when not focused), or `not-supports-[display:grid]:flex`.

The Wrong example `hover:bg-blue-500` with “No way to style non-hovered state specifically” is **false**. Unprefixed utilities *are* the non-hovered state. This is the core model on the same docs page: `bg-sky-500 hover:bg-sky-700`.

The Correct example `not-hover:opacity-75 hover:opacity-100` is equivalent to `opacity-75 hover:opacity-100` (and our house style already deletes restated `opacity-100` when it is a no-op default). An agent that “fixes” every `hover:` pair into `not-hover:`/`hover:` will bloat class lists and fight cleanup.

Do not salvage Rule 11 as written. A one-line canonical-table entry (`not-focus:`, `not-supports-[…]:`) is enough if we want the feature at all.

### Suspect 4 — `@import "tailwindcss" important;` — syntax exists; rule is D

**VERIFIED.** Exact form is documented ([styling-with-utility-classes § Using the important flag](https://tailwindcss.com/docs/styling-with-utility-classes)). Engine test uses `@import 'tailwindcss/utilities' important;` ([important.test.ts](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/important.test.ts)). v3 `important: '#selector'` is **not** this flag — it is a wrapper (`#app { @tailwind utilities; }`), discussion [#15866](https://github.com/tailwindlabs/tailwindcss/discussions/15866). Putting this on every project’s entry CSS is how an agent nukes specificity. Salvage lives in gotchas, not authoring rules.

### Suspect 5 — `starting:` — real name; example is the wrong shape

**VERIFIED.** Variant name is `starting`; it emits `@starting-style` ([hover-focus-and-other-states](https://tailwindcss.com/docs/hover-focus-and-other-states) table: `starting` → `@starting-style`; [v4 blog](https://tailwindcss.com/blog/tailwindcss-v4)). Official shape is popover/dialog entry, typically stacked with `open:` and `transition-discrete`:

```html
<div popover class="transition-discrete starting:open:opacity-0 ...">
```

Candidate: `starting:opacity-0 opacity-100 transition-opacity duration-300` on a generic div. `@starting-style` only applies on first render / `display:none`→visible ([MDN @starting-style](https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style)). It will not animate an always-visible node, and Tailwind’s own [compatibility](https://tailwindcss.com/docs/compatibility) page flags `@starting-style` as limited-support — “if the browsers you're targeting don't support them, simply don't use those utilities.” Do not promote this to a Critical Rule. Not salvaged as drop-in authoring guidance.

### Suspect 6 — Rule 6 Container Queries — viewport `md:` is not wrong

**VERIFIED.** Tailwind’s primary responsive docs are viewport breakpoints; the hero example is `md:flex` ([responsive-design](https://tailwindcss.com/docs/responsive-design)). Container queries are a separate section on the same page: “style something based on the size of a parent element **instead of** the size of the entire viewport.” The candidate’s own Correct comment admits “when sizing should be based on parent,” then labels the viewport pattern Wrong anyway. An agent will wrap page layouts in `@container` and swap `md:` → `@md:` (different breakpoints: viewport `md` = 48rem, container `@md` = 28rem). Salvage is the capability sentence in §2, not Rule 6.

### Suspect 7 — Rule 5 HEX in `@theme` vs our OKLCH house style

**VERIFIED** as a house-style collision, not a Tailwind falsehood. Tailwind’s own `@theme` examples use both OKLCH and hex (`--color-white: #fff` in the default theme dump on [theme](https://tailwindcss.com/docs/theme)). Our skill forbids hex/`rgb()`/`hsl()` in `:root`, `.dark`, and `@theme`. Copying Rule 5’s “Correct” block would regress that. Also too broad: Tailwind documents arbitrary values as first-class (`top-[117px]`, `grid-cols-[1fr_500px_2fr]`, [adding-custom-styles](https://tailwindcss.com/docs/adding-custom-styles)); our ladder already allows genuine one-offs. Do not import this rule.

### Suspect 8 — `--spacing-18: 4.5rem` — unnecessary, teaches a v3 habit

**VERIFIED.** Default `--spacing: 0.25rem`; `p-18` = `calc(var(--spacing) * 18)` = 4.5rem with no theme key ([v4 blog](https://tailwindcss.com/blog/tailwindcss-v4), [PR #14857](https://github.com/tailwindlabs/tailwindcss/pull/14857), [padding](https://tailwindcss.com/docs/padding)). `--spacing-*` named keys still work for *named* steps (`--spacing-gutter`), not to punch numbered holes. The example isn’t a syntax error; it is stale v3 config translated 1:1.

### Suspect 9 — PostCSS: `postcss-import` / autoprefixer / Lightning CSS

**VERIFIED** that the candidate’s config is the documented v4 PostCSS file ([upgrade-guide](https://tailwindcss.com/docs/upgrade-guide), [installation/using-postcss](https://tailwindcss.com/docs/installation/using-postcss), [compatibility](https://tailwindcss.com/docs/compatibility): “Tailwind itself will … bundle your imports and add vendor prefixes”). Nuance the candidate omits:

- Prefixing is Lightning CSS, targeting **modern** browsers (Chrome 111, Safari 16.4, Firefox 128), not Autoprefixer+browserslist for old WebKit.
- `@tailwindcss/postcss` runs Lightning CSS optimize in production (`NODE_ENV`), disable via `optimize: false` ([npm `@tailwindcss/postcss`](https://www.npmjs.com/package/@tailwindcss/postcss)).
- Vite projects should use `@tailwindcss/vite`, not this PostCSS plugin.

“NEVER use postcss-import or autoprefixer” is right for the v4 plugin graph. It is not “autoprefixer is built in for arbitrary old browsers.”

### Suspect 10 — `tailwind.config.js` / `@config`

**VERIFIED.** JS configs still work but are **not auto-detected**. Load with `@config "../../tailwind.config.js";` ([upgrade-guide](https://tailwindcss.com/docs/upgrade-guide), [functions-and-directives](https://tailwindcss.com/docs/functions-and-directives)). Unsupported from JS: `corePlugins`, `safelist`, `separator`. JS plugins can skip the config file entirely via `@plugin "@tailwindcss/typography"`. Legitimate cases: migrating a v3 config, third-party tooling that still emits JS theme, JS-computed tokens you have not moved to CSS. The candidate’s “unless JS-based dynamic config” is directionally right; “NEVER create” without `@config` leaves an agent stuck when a file must exist.

### Other C/D not in the suspect list

- **Rule 1 “removed entirely”:** public API is `@import "tailwindcss"`. `@tailwind utilities` still appears in engine tests as a compat hook (selector-scoped important). Fine as authoring guidance; not literally deleted from the parser. **INFERRED** leftover from `important.test.ts`.
- **Rule 10 / Anti-Pattern NEVER `bg-gradient-to-*`:** `bg-linear-to-*` is canonical ([background-image](https://tailwindcss.com/docs/background-image)). `bg-gradient-to-*` is still registered in [`packages/tailwindcss/src/compat/legacy-utilities.ts`](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/compat/legacy-utilities.ts). Rewriting it on sight is a canonicalisation, not a correctness fix. We already map it in the canonical table — keep that; reject the NEVER.

---

## 4. BUGS FOUND IN *OUR* SKILL

Nothing on the scale of the old “`@apply` loses variants” claim. Two wording issues the real docs expose:

### 1. `SKILL.md` / `cleanup.md`: “post-migration names”

> On v4 code, `shadow`, `rounded`, `ring`, and `outline-none` are already the post-migration names. Never remap them to `shadow-sm` / `rounded-sm` / `ring-3` / `outline-hidden`.

The **instruction** is right (it is how we avoid Rule 9). The **rationale** is sloppy:

| Token | What v4 actually is | What the upgrade map does |
| --- | --- | --- |
| bare `shadow` / `rounded` | Backward-compat aliases ([upgrade-guide](https://tailwindcss.com/docs/upgrade-guide): “bare versions still work”) | v3 bare → v4 `-sm` **named** |
| `ring` | **1px** + `currentColor` in v4 | v3 `ring` (3px) → `ring-3` |
| `outline-none` | Real `outline-style: none` in v4 | v3 `outline-none` → `outline-hidden` |

Calling them “already the post-migration names” is what the candidate gets wrong in the other direction. Tighten to: *these classes are valid v4; do not apply the v3→v4 upgrade remaps on v4-authored code — that changes visuals* (`ring`→`ring-3`, `outline-none`→`outline-hidden`) *or is a no-op rename* (`shadow`→`shadow-sm`). Never rewrite v4 `shadow-sm` to `shadow-xs`.

### 2. `setup.md` dark variant vs Tailwind’s own snippet

We ship `@custom-variant dark (&:is(.dark *));` (shadcn). Tailwind’s current docs recommend `@custom-variant dark (&:where(.dark, .dark *));` ([dark-mode](https://tailwindcss.com/docs/dark-mode)). Differences: `:where` (zero specificity) vs `:is`; and `.dark, .dark *` matches the `.dark` **element itself**, not only descendants. With `class="dark"` on `<html>` and `dark:` only on children (next-themes), both work. `dark:` on the `.dark` node itself would miss under ours. Not a false Tailwind claim — it is a shadcn/Tailwind divergence already discussed upstream ([shadcn-ui/ui#8481](https://github.com/shadcn-ui/ui/discussions/8481)). Optional one-liner in `setup.md`; do not “fix” it unprompted (would drift from vendored shadcn CSS).

### Not bugs (checked)

- `@theme inline` explanation matches [theme § Referencing other variables](https://tailwindcss.com/docs/theme). **VERIFIED.**
- `hover:` wrapping `@media (hover: hover)` matches [upgrade-guide § Hover styles on mobile](https://tailwindcss.com/docs/upgrade-guide). **VERIFIED.**
- Preflight `cursor: default` on buttons matches [upgrade-guide § Buttons use the default cursor](https://tailwindcss.com/docs/upgrade-guide). **VERIFIED.**
- Slash opacity → `color-mix(in oklab, …)` matches the v4 blog + `gotchas.md`. **VERIFIED.**
- No remaining “`@apply` drops variants” claim in `SKILL.md` / references.

---

## Suspects — confirm/refute (short)

| # | Suspect | Verdict |
| --- | --- | --- |
| 1 | Rule 9 / NEVER `shadow-sm` | **Refute as authoring rule.** Will rewrite valid v4 `shadow-sm`/`blur-sm`/`rounded-sm` to `-xs` and change visuals. |
| 2 | `@variant` for defining variants | **Refute.** Defining = `@custom-variant`. `@variant` = apply a variant in CSS. Beta name. |
| 3 | Rule 11 Wrong/Correct | **Refute the framing.** `not-*` is real; `hover:bg-blue-500` is not “no way”; `not-hover:opacity-75 hover:opacity-100` is noise. |
| 4 | `@import "tailwindcss" important;` | **Confirm syntax.** **Refute as a default rule.** |
| 5 | `starting:` | **Confirm the variant name.** **Refute the example** as the thing to emit by default. |
| 6 | `md:flex-row` is Wrong | **Refute.** Viewport breakpoints are still the default. |
| 7 | HEX in `@theme` / rare arbitrary values | **Confirm conflict** with our OKLCH house style. Do not import. |
| 8 | `--spacing-18` | **Refute as needed.** `p-18` already exists via `--spacing`. |
| 9 | postcss-import / autoprefixer | **Confirm the PostCSS graph.** Add Lightning CSS + modern-browser-target nuance. |
| 10 | NEVER `tailwind.config.js` | **Mostly confirm as default.** Still needed via `@config`; plugins via `@plugin`. `corePlugins`/`safelist`/`separator` unsupported. |
