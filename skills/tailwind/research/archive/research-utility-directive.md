> **Archive pointer.** Only the `@utility` vs `@layer utilities` distinction shipped. Extra authoring depth left out on purpose. Index: [README.md](README.md).

# `@utility` in Tailwind v4 — house-style research

Research date: **2026-08-18**. Scope: a Tailwind v4 + shadcn semantic-token skill for a coding agent. Engine on `main` as of this research: **4.3.3** (released 2026-07-16). v4.0 shipped **2025-01-22**.

Legend: **VERIFIED** = read in current official docs, changelog, or first-party source. **COMMUNITY OPINION** = GitHub discussion / maintainer comment / third-party writing, not a spec. **BETA-ERA** = claim from 2024 / v4-alpha/beta only.

---

## 1. What `@utility` is

v4's CSS-first way to **register a class into the utilities pipeline**. It is not a CSS cascade layer you write yourself. The compiler emits the class into `@layer utilities` next to core utilities, with variant / important / prefix machinery attached.

**VERIFIED** — [Adding custom styles](https://tailwindcss.com/docs/adding-custom-styles) (fetched 2026-08-18); [Functions and directives](https://tailwindcss.com/docs/functions-and-directives); [Upgrade guide](https://tailwindcss.com/docs/upgrade-guide).

### Static form

```css
@utility content-auto {
  content-visibility: auto;
}
```

```html
<div class="content-auto hover:content-auto lg:content-auto">
```

Nested selectors are allowed (docs call this "complex utilities"):

```css
@utility scrollbar-hidden {
  &::-webkit-scrollbar {
    display: none;
  }
}
```

**VERIFIED** — same adding-custom-styles page. Nesting flattening in production: **COMMUNITY OPINION** — [Discussion #19572](https://github.com/tailwindlabs/tailwindcss/discussions/19572) (undated; post-stable).

`@apply` inside `@utility` works, including applying another custom utility and variant-prefixed utilities. Circular `@apply` graphs error.

**VERIFIED** — [PR #14144](https://github.com/tailwindlabs/tailwindcss/pull/14144) merged 2024-08-09 (beta, still current). Example from that PR:

```css
@utility btn {
  @apply flex flex-col bg-white p-4 rounded-lg shadow-md;
}

@utility bar {
  @apply hover:foo;
}
```

### Functional form (`-*` + `--value()` / `--modifier()`)

Name **must** end in `-*`. `--value()` resolves the candidate; `--modifier()` resolves the `/…` part. Unresolved declarations are dropped.

**VERIFIED** — adding-custom-styles; [PR #15455](https://github.com/tailwindlabs/tailwindcss/pull/15455) (functional CSS utilities). Docs examples:

```css
@theme {
  --tab-size-2: 2;
  --tab-size-4: 4;
  --tab-size-github: 8;
}

@utility tab-* {
  tab-size: --value(--tab-size-*);          /* tab-2, tab-4, tab-github */
}

@utility tab-* {
  tab-size: --value(integer);               /* tab-1, tab-76 — bare types: number, integer, ratio, percentage */
}

@utility tab-* {
  tab-size: --value([integer]);             /* tab-[1] */
}

@utility tab-* {
  tab-size: --value("inherit", "initial", "unset");  /* literals */
}

@utility tab-* {
  tab-size: --value(--tab-size-*, integer, [integer]); /* L→R, first match wins */
}

@utility text-* {
  font-size: --value(--text-*, [length]);
  line-height: --modifier(--leading-*, [length], [*]);
}

@utility aspect-* {
  aspect-ratio: --value(--aspect-ratio-*, ratio, [ratio]); /* slash = fraction, not modifier */
}

@utility inset-* {
  inset: --spacing(--value(integer));
  inset: --value([percentage], [length]);
}
@utility -inset-* {                         /* negatives are a second utility */
  inset: --spacing(--value(integer) * -1);
  inset: calc(--value([percentage], [length]) * -1);
}
```

`--default()` (inside `--value()` / `--modifier()`) lets the bare name work. Shipped **v4.3.0, 2026-05-08**.

**VERIFIED** — [v4.3.0 changelog](https://github.com/tailwindlabs/tailwindcss/releases/tag/v4.3.0); [v4.3 blog](https://tailwindcss.com/blog/tailwindcss-v4-3) (2026-05-08); [PR #19989](https://github.com/tailwindlabs/tailwindcss/pull/19989).

```css
@utility tab-* {
  tab-size: --value(integer, --default(4));
}
/* .tab { tab-size: 4 } and .tab-2 { tab-size: 2 } */
```

As of 4.3.0, a functional `@utility` **must** contain a resolvable `--value(…)` ([#20005](https://github.com/tailwindlabs/tailwindcss/pull/20005)). Multiple same-name functional `@utility`s with different value types all run ([#19777](https://github.com/tailwindlabs/tailwindcss/pull/19777), 2026-03; shipped 4.3.0).

Arbitrary CSS variables: `--value([*])` → `my-utility-(--my-variable)`. Typed `--value([length])` needs a hint: `my-utility-(length:--css-variable)`.

**VERIFIED** — [Discussion #18792](https://github.com/tailwindlabs/tailwindcss/discussions/18792), answer by Tailwind collaborators.

`--value(--color-*-500)` (wildcard with a suffix after `*`) does **not** work. The `*` is the whole remainder.

**COMMUNITY OPINION** — [Discussion #18097](https://github.com/tailwindlabs/tailwindcss/discussions/18097).

**Collision note:** v4.3.0 **shipped core `tab-*` utilities**. The docs' running example is now a real name clash with core. **VERIFIED** — v4.3.0 notes, [PR #20022](https://github.com/tailwindlabs/tailwindcss/pull/20022).

### vs v3 `@layer components` / `@layer utilities`

v3 hijacked `@layer`: a class inside `@layer utilities` or `@layer components` was treated as a real utility (variants worked). `components` always sorted before `utilities`.

v4 uses **native** cascade layers and no longer hijacks `@layer`. A plain `.foo` inside `@layer utilities` is just CSS. No variants, no IntelliSense as a utility, not `@apply`-able.

Replacement: `@utility`.

**VERIFIED** — upgrade guide, "Adding custom utilities"; IntelliSense maintainer [thecrypticace on #1148](https://github.com/tailwindlabs/tailwindcss-intellisense/issues/1148) (2025-01).

v4 still documents `@layer components` for multi-property "card / btn / badge" classes you want utilities to override, and for third-party widget skins. That is **unregistered CSS**, not a utility.

**VERIFIED** — adding-custom-styles, "Adding component classes", which still says you probably don't need these as often as you think and points at [managing duplication](https://tailwindcss.com/docs/styling-with-utility-classes).

### vs JS `addUtilities` / `matchUtilities`

| v3 / JS plugin | v4 CSS |
| --- | --- |
| `addUtilities({ '.x': { … } })` | `@utility x { … }` |
| `matchUtilities({ tab: (v) => ({ 'tab-size': v }) }, { values })` | `@utility tab-* { tab-size: --value(--tab-size-*); }` |
| `addVariant` | `@custom-variant` |

**VERIFIED** mapping — collaborator walkthrough in [Discussion #18648](https://github.com/tailwindlabs/tailwindcss/discussions/18648) (2025); [Discussion #15829](https://github.com/tailwindlabs/tailwindcss/discussions/15829).

Remaining JS-plugin differences that still matter:

- `matchUtilities` with `type: "color"` auto-gets opacity modifiers (`foo-black/33`). CSS `@utility` does **not** — you write `--modifier()` yourself. **VERIFIED** — [PR #14114](https://github.com/tailwindlabs/tailwindcss/pull/14114) (2024-08, still the JS API); **COMMUNITY OPINION** confirming the CSS side — wongjn in [#17238](https://github.com/tailwindlabs/tailwindcss/discussions/17238) (2025-03-17): "only dynamic utilities can have modifiers."
- CSS `@utility` / `@theme` / `@custom-variant` **merge with and otherwise take precedence over** JS config/plugins. **VERIFIED** — functions-and-directives, Compatibility.
- JS plugins remain for programmatic generation that CSS cannot express. `@plugin` is documented as **v3 compatibility**, not the preferred v4 authoring path. **VERIFIED** — same page. **COMMUNITY OPINION** that plugin docs are still thin: [Discussion #15715](https://github.com/tailwindlabs/tailwindcss/discussions/15715).

---

## 2. Why it exists (problems `@apply` / `@layer components` do not solve)

### Variant support — yes, including stacked / `group-*` / `dark:` / `md:`

Official contract: custom `@utility` classes "work with variants like `hover`, `focus` and `lg`". They land in the same compile path as core utilities (`compileAstNodes` applies `candidate.variants` via `applyVariant`).

**VERIFIED** — functions-and-directives; adding-custom-styles (`hover:content-auto`); [PR #14044](https://github.com/tailwindlabs/tailwindcss/pull/14044) example `lg:dark:text-trim`; source [`compile.ts`](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/compile.ts) `applyVariant` loop.

`group-*` / `peer-*` / `@custom-variant` prefixes are variants, not special cases. They apply to any registered utility, including custom ones. No extra registration.

**VERIFIED** (mechanism) — compile path above; **VERIFIED** (docs examples for core, same machinery) — [Hover, focus, and other states](https://tailwindcss.com/docs/hover-focus-and-other-states). Direct `group-hover:<custom-utility>` example is not on the `@utility` docs page; inference from the shared pipeline is strong.

Contrast: a class in `@layer components` does **not** get `hover:` / `md:` as a prefix on the class name. To vary it you write CSS (`@variant dark { … }` inside the rule) or you register it with `@utility`.

**VERIFIED** — adding-custom-styles "Using variants" vs "Adding custom utilities"; thecrypticace on IntelliSense [#1247](https://github.com/tailwindlabs/tailwindcss-intellisense/issues/1247) / [Discussion #1452](https://github.com/tailwindlabs/tailwindcss-intellisense/discussions/1452) (2025-03+): classes in native `@layer utilities|components` "don't get support for variants, modifiers, being marked as important, prefixing, etc. To do that you must use `@utility`."

`@apply hover:bg-primary` **does work** in current v4. Tailwind engineer thecrypticace, 2025: "Variants still work and have never not worked" ([#18570](https://github.com/tailwindlabs/tailwindcss/issues/18570)). PR #14144 uses `@apply hover:foo` inside `@utility`. The house skill's " `@apply` loses variants" line is **not** in current official docs. Baking states into a composed class is still the wrong *design*, even if the syntax compiles.

### Cascade layer + sort order

`@utility` is always emitted in `@layer utilities`. Sort key = (properties used against a global property-order list, then **property count descending** so a fat "component" utility sorts *before* a one-property core utility and can be overridden without `!`).

**VERIFIED** — upgrade guide; [PR #16715](https://github.com/tailwindlabs/tailwindcss/pull/16715); `getPropertySort` in [`compile.ts`](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/compile.ts); maintainer Adam Wathan-adjacent explanation on [Discussion #14363](https://github.com/tailwindlabs/tailwindcss/discussions/14363) (2024-09, still cited 2026); Robin Malfait on [#15045](https://github.com/tailwindlabs/tailwindcss/issues/15045): v4 deliberately made `addComponents` an alias of `addUtilities` because sorting replaced the components/utilities split.

This is the problem `@layer components` solved in v3 (always first) and `@apply` does not (it inlines into *your* rule, at *your* layer).

Surprise: sort is by **which CSS properties**, not by source order. Two utilities with disjoint properties have a deterministic but non-obvious order. A 3-property type style can still lose to `text-sm` if `var()` placeholders confuse the counter — that was a real bug, fixed. **VERIFIED** — [#16973](https://github.com/tailwindlabs/tailwindcss/issues/16973) → [PR #16995](https://github.com/tailwindlabs/tailwindcss/pull/16995) (2025).

### IntelliSense

- Static `@utility`: completions + hovers. **VERIFIED** — thecrypticace, IntelliSense [#1148](https://github.com/tailwindlabs/tailwindcss-intellisense/issues/1148) (2025-01): switch `@layer components` → `@utility` and "hovers and completions work."
- Functional `@utility foo-*`: generated in CSS; autocomplete of the prefix is **uneven**. Play suggests them; some VS Code setups do not. **COMMUNITY OPINION** — [Discussion #18291](https://github.com/tailwindlabs/tailwindcss/discussions/18291) (2025-06-11).
- `@layer components` / native `@layer utilities`: **not** treated as utilities by IntelliSense. **VERIFIED** — #1148, #1247, Discussion #1452.

### tailwind-merge

tailwind-merge **does not read your CSS**. It has a hardcoded model of core Tailwind. A custom `@utility`:

- with a **novel prefix** (`content-auto`, `scrollbar-hidden`): kept, never conflict-resolved against `p-4` / `bg-primary`.
- that **looks like core** (`text-2xs`, `text-stroke-*`, extra `shadow-*`): treated as the core group; `cn('text-sm', 'text-2xs')` drops `text-sm`.

**VERIFIED** — [tailwind-merge limitations](https://github.com/dcastil/tailwind-merge/blob/main/docs/limitations.md) (fetched 2026-08-18); [recipes](https://github.com/dcastil/tailwind-merge/blob/main/docs/recipes.md) (author: do not `@apply` classes that then go through `twMerge`); real breakage: [tailwindcss Discussion #18505](https://github.com/tailwindlabs/tailwindcss/discussions/18505) (2025-07-10) — `cn()`/`twMerge` stripped `@utility` classes that matched `text-*`. Theme-scale extensions (`--shadow-popover`) also need `extendTailwindMerge` — [#595](https://github.com/dcastil/tailwind-merge/issues/595) (v4, 2025).

### `!important` and opacity modifiers

**Important:** yes for normal properties. Candidate `foo!` / `hover:foo!` goes through `applyImportant` in `compileAstNodes`. **VERIFIED** — `compile.ts`; v4 important-at-end in the upgrade guide.

Caveat: utilities that **only set a custom property** dropped `!important` for a while (Chrome rejects `!important` inside some var definitions). Restored: [PR #16873](https://github.com/tailwindlabs/tailwindcss/pull/16873) following [#16810](https://github.com/tailwindlabs/tailwindcss/issues/16810) (2025-02). If targeting an old 4.0.x, inlining `!important` in the `@utility` body was the workaround.

**Opacity `/50`:** **not automatic** on a static `@utility`. `text-default/50` is a no-op unless the utility is functional and implements `--modifier()`, or you never wrote a custom utility and used `@theme --color-default` / `--text-color-default` instead (core color utilities already run `color-mix`).

**VERIFIED** (team) — wongjn, [#17238](https://github.com/tailwindlabs/tailwindcss/discussions/17238) (2025-03-17). `--default()` in 4.3 exists partly so CSS can express `shadow/50` without a value ([#19989](https://github.com/tailwindlabs/tailwindcss/pull/19989) / [#16824](https://github.com/tailwindlabs/tailwindcss/issues/16824)).

---

## 3. Decision rule: `@theme` vs `@utility` vs `@apply` vs plain class vs component

Official v4 duplication guide (current, not v3): **loops → multi-cursor → components/partials**. CSS extraction is last and small.

**VERIFIED** — [Styling with utility classes](https://tailwindcss.com/docs/styling-with-utility-classes) ("Managing duplication"); adding-custom-styles still points there. v3 "don't `@apply` to look cleaner" is **BETA-ERA / v3** ([v3 reusing-styles](https://v3.tailwindcss.com/docs/reusing-styles)) but the v4 page kept the same ladder without the `@apply` sermon; `@apply`'s current documented job is **third-party CSS overrides**, not component extraction. **VERIFIED** — functions-and-directives `@apply`.

How 2025–2026 practitioners actually draw the line:

| Reach for | When | Source |
| --- | --- | --- |
| **`@theme` / `@theme inline`** | The thing is a **token** (color, radius, shadow, font, spacing step) that should mint *normal* utilities (`bg-warning`, `shadow-popover`) with opacity/variants for free | **VERIFIED** — [Theme variables](https://tailwindcss.com/docs/theme); shadcn [Theming](https://ui.shadcn.com/docs/theming) "Adding New Tokens" (current); wongjn in #17238 preferring `--color-default` over `@utility text-default` |
| **`@utility`** | Tailwind has **no utility for this CSS feature**, and you need it in HTML with variants: `content-visibility`, extra scrollbar tricks, `-webkit-text-stroke`, `tab-size` (until 4.3 shipped it), extending `container` | **VERIFIED** — adding-custom-styles ("CSS feature you'd like to use… that Tailwind doesn't include"); upgrade guide `container` example |
| **React/Vue/Svelte component** (classes inline, `cn()` for the override slot) | The pattern is a **composition of existing utilities** (button, card, type recipe `text-3xl font-bold lg:text-5xl`) | **VERIFIED** — v4 managing-duplication; **COMMUNITY OPINION** repeating it for `@utility` "typography" dumps — Discussion #1452 (2025) |
| **`@apply`** | Overriding **someone else's** stylesheet (Select2, a native widget) while still speaking in tokens | **VERIFIED** — functions-and-directives |
| **Plain `@layer components` class** | Multi-property skin that must stay **weaker** than utilities *and* does not need `hover:class` as a prefix; or third-party DOM you don't own | **VERIFIED** — adding-custom-styles. Sort-based `@utility btn` is the upgrade-guide alternative if you also want variants/IntelliSense |

**Do not** promote a repeated *length/color* to `@utility`. Promote it to `@theme`. That is already the house skill's ladder; `@utility` is a different axis (missing *API*, not missing *token*).

**Do not** wrap `flex items-center justify-center` as `@utility flex-center`. That is the shadow vocabulary failure. **COMMUNITY OPINION** — widely practiced in 2025 tutorials; contradicts official duplication guidance.

Experienced 2025–2026 writing is consistent: shadcn itself adds tokens via `@theme inline`, not `@utility` ([theming docs](https://ui.shadcn.com/docs/theming); [customization skill](https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/customization.md)). Registry *can* ship `@utility` for actual CSS features ([Discussion #9944](https://github.com/shadcn-ui/ui/discussions/9944)) — that is the intended seam, not buttons.

---

## 4. Interaction with shadcn / semantic tokens / `cn()`

### `@theme inline` — no conflict, complementary

shadcn: values in `:root` / `.dark`, bridge with `@theme inline { --color-primary: var(--primary); }`. That mints `bg-primary`, `text-primary`, `border-primary`, `ring-primary`, plus `/30` via `color-mix`. A custom `@utility` that re-implements `text-primary` is strictly worse (no opacity, fights `cn()`, duplicates the token).

**VERIFIED** — [ui.shadcn.com/docs/theming](https://ui.shadcn.com/docs/theming); [Tailwind theme `inline`](https://tailwindcss.com/docs/theme); this repo's `tailwind/references/setup.md`.

`@utility` that **consumes** those tokens is fine:

```css
@utility content-auto {
  content-visibility: auto;
}
/* still write bg-background text-foreground next to it */
```

`--value(--color-*)` against the shadcn `--color-*` namespace works because `@theme inline` still registers the namespace. Restrict to `--color-*`, not `--*` (otherwise `text-4xl` radius keys leak in). **COMMUNITY OPINION** — comment on [#16824](https://github.com/tailwindlabs/tailwindcss/issues/16824) (2025-02).

### `cn()` / tailwind-merge — this is the footgun

shadcn's `cn` = `twMerge(clsx(…))`. Custom `@utility` is invisible to the merger unless you `extendTailwindMerge`.

What breaks if it doesn't know:

1. **False conflict:** `cn('text-sm', 'text-stroke-width-1')` may drop `text-sm`. Seen in production: Discussion #18505 (2025-07).
2. **No conflict when there is one:** `cn('p-4', 'card-padding')` keeps both; padding doubles. **VERIFIED** — tailwind-merge limitations ("Doesn't understand custom CSS").
3. **Theme extras on a known scale:** `--shadow-popover` → `shadow-popover` is *not* in the default `shadow` group until you extend the config. [#595](https://github.com/dcastil/tailwind-merge/issues/595).

Author of tailwind-merge: don't `@apply` a `.btn-primary` and then `twMerge` it — the merge config cannot stay in sync with the CSS. Keep the class list in JS. **VERIFIED** — recipes.md.

### Naming that avoids collisions

- Do **not** reuse core prefixes: `text-`, `bg-`, `p-`, `m-`, `shadow-`, `border-`, `ring-`, `font-`, `rounded-`, `w-`, `h-`, `gap-`, `flex-`, `grid-`.
- Prefer a **project/feature prefix** that is not a T-shirt size after a core stem: `app-`, `ui-`, or a domain word (`prose-` is already typography plugin). tailwind-merge docs suggest `typography-2xs` not `text-2xs`, `ui-text-special` not `text-special`. **VERIFIED** — limitations.md.
- Do not pick names Tailwind is likely to ship. `tab-*` and `scrollbar-*` were the textbook `@utility` examples; **both became core in 4.3.0** (2026-05-08). Your `@utility` then *adds* to the same name (4.3.0 runs multiple handlers) — surprise properties, surprise merge behavior. **VERIFIED** — v4.3.0 notes; Robin on [#16948](https://github.com/tailwindlabs/tailwindcss/issues/16948) / [PR #19777](https://github.com/tailwindlabs/tailwindcss/pull/19777): CSS `@utility` handlers all run; last-wins vs core is **not** guaranteed.

---

## 5. Gotchas and anti-patterns

### Dumping ground — yes, it is the new `@layer components`

Upgrade guide *invites* `@utility btn { padding; radius; background }`. That is how you port v3 component classes and keep variants + override-by-sort.

2025–2026 pushback: that recreates a global named-component layer inside `utilities`, fights `cn()`, and is weaker than a React component for anything with HTML structure.

**COMMUNITY OPINION** — Discussion #1452 (2025); daisyUI author pain on [#15045](https://github.com/tailwindlabs/tailwindcss/issues/15045) (sort order of "components" now in utilities); nested-layer hacks still circulating in 2026 ([#14363](https://github.com/tailwindlabs/tailwindcss/discussions/14363) comment 2026-05-12).

Official docs still also say: use `@layer components` for card/btn **or** don't extract at all. The upgrade-guide `btn` snippet is a **migration compatibility** pattern, not a greenfield recommendation.

### Name collisions with future Tailwind

See §4. Treat `@utility` names as a **public API**. Prefix them. When 4.3 shipped `tab-*` and `scrollbar-*`, unprefixed copies became dual-definition.

### `@reference` / Vue / Svelte / CSS modules

`@utility` must be **defined in the compiled CSS graph** (globals.css, or a file `@import`ed into it). `@reference` only makes those definitions *visible* to `@apply` / `@variant` in a separately bundled file; it does **not** emit the utility.

**VERIFIED** — functions-and-directives `@reference`; upgrade guide "Using @apply with Vue, Svelte, or CSS modules"; [compatibility](https://tailwindcss.com/docs/compatibility).

**COMMUNITY OPINION** — [Discussion #17912](https://github.com/tailwindlabs/tailwindcss/discussions/17912): `@utility` in a file that is only `@reference`d never appears in HTML; move the definition to globals. Wrapping the import in `layer(utilities)` **errors** when the file contains `@utility` (same thread). Import the file plain: `@import "./utilities.css";` — `@utility` already targets the utilities layer.

`@apply` of a custom class requires that class to be a registered `@utility`, not a `.foo` in `@layer utilities`. **COMMUNITY OPINION** (recent) — [Discussion #20211](https://github.com/tailwindlabs/tailwindcss/discussions/20211); consistent with Robin on #15139 (beta, still true).

Performance: each Vue/Svelte `<style>` / CSS module that `@reference`s globals re-runs Tailwind. Official recommendation: prefer `var(--color-primary)` / `--spacing(6)` and skip `@apply`/`@reference`. **VERIFIED** — upgrade guide; compatibility page ("50 CSS modules → Tailwind runs 50 times").

### Build / performance of `@utility` itself

A custom utility is generated **only when the class appears in content**, same as core. No inherent bundle tax. Cost is: more names for the agent to invent; more `cn()` config; IntelliSense catalog size (functional `-*` completions already a weak spot).

Unrelated but adjacent: scanning `tailwind-merge`'s default-config used to emit huge CSS; fixed in **4.0.1** (2025-01). **VERIFIED** — [#15722](https://github.com/tailwindlabs/tailwindcss/issues/15722).

### `@utility` + `@variant` / `@custom-variant`

- `@custom-variant` applies to custom `@utility` classes in HTML (`theme-midnight:content-auto`). Same pipeline.
- `@variant` inside CSS (including inside `@utility`) compiles a variant into the definition (baked in). Stacked `hover:focus` and compound `hover, focus` are official as of **4.3.0**. **VERIFIED** — adding-custom-styles; [PR #19996](https://github.com/tailwindlabs/tailwindcss/pull/19996); v4.3 blog.
- Do not confuse them: `@custom-variant` = new prefix for *every* utility; `@variant` = wrap *these* declarations.

### Ordering / specificity surprises

- Property-count sort ≠ source order. Fat custom utility first, thin core later — until the properties don't overlap, then order is "whatever the property-order table says."
- Nested `@layer` inside `@utility` creates **sublayers** (`utilities.affordances.modifiers`) and `@apply` of that utility copies the sublayer — 2026 report that this is a trap; `:where(&)` reset suggested instead. **COMMUNITY OPINION** — #14363 (2026-05-12).
- Unlayered CSS beats all layers. A stray `.btn { }` outside `@utility` / `@layer` will crush utilities.
- `@apply` only sees registered utilities; order of definition in a file can still 404 if you `@apply` a custom name that isn't `@utility`.

### Other sharp edges

- Functional `--modifier()` on a **static** `@utility` (no `-*`) does not parse. **VERIFIED** as a limitation — [#16824](https://github.com/tailwindlabs/tailwindcss/issues/16824) (2025-02); `--default()` in 4.3 is the CSS-side fix for "bare name + modifier" (`shadow/50`).
- Cannot group `@utility a, @utility b { … }`. One name per rule. **COMMUNITY OPINION** — #1148 comments.
- Extending a core utility (`@utility text-sm { … extra prop }`) is supported (PR #14044) but you must restate the original declarations; prefer `@theme` if you only need to change a token. **VERIFIED** — PR #14044 text ("preferred… override the theme instead").

---

## 6. Should the house-style skill mention `@utility`?

### Against

The skill's job is to stop agents inventing a shadow scale. `@utility` is a **name-minting API**. Given the upgrade-guide `btn` example and a thousand 2025 blog posts of `@utility flex-center`, an LLM will dump compositions into `@utility` the same way it once dumped them into `@layer components`. Each name is a collision with core, with `cn()`, and with the next Tailwind minor (see `tab-*` / `scrollbar-*` in 4.3.0). shadcn's actual extension point is `@theme inline`, which this skill already teaches.

### For

Agents already hit the wall: "I need `content-visibility`", "v3 `@layer utilities` stopped working", "IntelliSense doesn't see my class", "`hover:my-glass` does nothing". Without a gated rule they will (a) write unlayered CSS, (b) use `@layer utilities` like v3, or (c) invent `@apply` component classes. A **tight gate** is cheaper than those three failure modes. The skill already has a ladder for *values* (`scale → @theme → arbitrary`); it needs a sibling ladder for *APIs*.

### Verdict

**Include it, as a closed gate, not as a capability to explore.** Do not document `--value()` / `--modifier()` in the always-on skill body — that is how the parallel vocabulary starts. Point at a short reference page if a CSS feature is genuinely missing.

### Tightest agent rule (drop-in)

1. **Do not reach for `@utility` unless Tailwind has no utility for that CSS property/feature** (or you are extending `container` as in the upgrade guide).
2. **A repeated value is `@theme` (shadcn: `:root` + `@theme inline`), never `@utility`.** Colours in particular: `--color-*` gives `bg-`/`text-`/`border-` + `/opacity` for free; a custom `text-brand` utility does not.
3. **A repeated composition of existing utilities is a component (or a JS class-string constant), never `@utility` and never `@apply`.**
4. If you must add a utility: one concern, **prefix the name** (`app-` / `ui-` / domain — never `text-`/`bg-`/`p-`/`shadow-`), define it in the **global CSS** (not a `@reference`d Vue/Svelte block, not `@import … layer(utilities)`), and **do not pass it through `cn()`/`twMerge` unless `extendTailwindMerge` knows the group**.
5. Prefer `hover:app-foo` in markup over baking states into the utility. `@custom-variant` is for new *conditions*; `@utility` is not a place to hide `md:`/`dark:`.
6. If `cn()` would need to know that the new class conflicts with `p-*` / `text-*` / `bg-*`, you chose the wrong abstraction — use a component.

---

## Source index (dates)

| Date | Kind | URL |
| --- | --- | --- |
| 2026-08-18 (fetched) | Official docs | https://tailwindcss.com/docs/adding-custom-styles |
| 2026-08-18 (fetched) | Official docs | https://tailwindcss.com/docs/functions-and-directives |
| 2026-08-18 (fetched) | Official docs | https://tailwindcss.com/docs/upgrade-guide |
| 2026-08-18 (fetched) | Official docs | https://tailwindcss.com/docs/theme |
| 2026-08-18 (fetched) | Official docs | https://tailwindcss.com/docs/styling-with-utility-classes |
| 2026-08-18 (fetched) | Official docs | https://tailwindcss.com/docs/compatibility |
| 2025-01-22 | First-party blog | https://tailwindcss.com/blog/tailwindcss-v4 |
| 2026-05-08 | First-party blog + release | https://tailwindcss.com/blog/tailwindcss-v4-3 · https://github.com/tailwindlabs/tailwindcss/releases/tag/v4.3.0 |
| 2026-07-16 | Changelog | https://github.com/tailwindlabs/tailwindcss/blob/main/CHANGELOG.md (4.3.3) |
| 2024-07 / still cited | PR (simple `@utility`) | https://github.com/tailwindlabs/tailwindcss/pull/14044 |
| 2024-08 | PR (`@apply` in `@utility`) | https://github.com/tailwindlabs/tailwindcss/pull/14144 |
| 2024-08 | PR (JS `addUtilities`/`matchUtilities`) | https://github.com/tailwindlabs/tailwindcss/pull/14114 |
| 2025-01 | IntelliSense | https://github.com/tailwindlabs/tailwindcss-intellisense/issues/1148 |
| 2025-02 | Issues | https://github.com/tailwindlabs/tailwindcss/issues/16810 · https://github.com/tailwindlabs/tailwindcss/issues/16824 |
| 2025-03-17 | Team answer (opacity) | https://github.com/tailwindlabs/tailwindcss/discussions/17238 |
| 2025-03+ | IntelliSense layers | https://github.com/tailwindlabs/tailwindcss-intellisense/issues/1247 · https://github.com/tailwindlabs/tailwindcss-intellisense/discussions/1452 |
| 2025-06-11 | Functional IntelliSense | https://github.com/tailwindlabs/tailwindcss/discussions/18291 |
| 2025-07-10 | `twMerge` strips `@utility` | https://github.com/tailwindlabs/tailwindcss/discussions/18505 |
| 2026-03 / 4.3.0 | Multi-handler `@utility` | https://github.com/tailwindlabs/tailwindcss/pull/19777 |
| 2026-05 | `--default()` | https://github.com/tailwindlabs/tailwindcss/pull/19989 |
| 2026-08-18 (fetched) | tailwind-merge | https://github.com/dcastil/tailwind-merge/blob/main/docs/limitations.md · recipes.md |
| 2026-08-18 (fetched) | shadcn | https://ui.shadcn.com/docs/theming · https://ui.shadcn.com/docs/tailwind-v4 |

v3 reusing-styles / extracting-components pages are **pre-2025**; used only to note that v4 dropped the `@apply` sermon but kept the component-first ladder.
