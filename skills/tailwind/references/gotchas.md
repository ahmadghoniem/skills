# Tailwind v4 gotchas

Read this when a utility isn't doing what it should, when a build errors on an unknown utility, or when touching CSS outside the main stylesheet.

Contents:

- `@apply` in separately-bundled CSS needs `@reference`
- Bare-channel tokens are completely dead
- `group` / `peer` / `@container` need the marker class
- `@md:` is a container query, not a breakpoint
- `h-screen` ignores mobile browser chrome
- Dynamic class names are never generated
- `truncate` inside a flex/grid item needs `min-w-0`
- Arbitrary values
- `!` important
- A v3 entry file fails silently
- Mobile-first breakpoints

## `@apply` in separately-bundled CSS needs `@reference`

v4 resolves `@apply`/`theme()` against the theme in *that file's* compile context. Vue/Svelte `<style>` blocks, CSS Modules, and Astro `<style>` don't see the theme → "Cannot apply unknown utility class." Add `@reference "../app.css"` (or `@reference "tailwindcss"` for the default theme) at the top.

`@reference` makes Tailwind re-run for that file. It was pathological before 4.1.6 ([#17836](https://github.com/tailwindlabs/tailwindcss/pull/17836) stopped the per-`@reference` rescan) and is still per-file work, so in scoped blocks **prefer the CSS variables directly**:

```css
background: var(--primary);
padding: calc(var(--spacing) * 6);
box-shadow: var(--shadow-md);
```

Plain CSS, no `@reference`, no Tailwind involvement. Two traps here:

- Reference `var(--primary)`, **not** `var(--color-primary)`. The `--color-*` names are the `@theme inline` bridge that generates utilities; `--primary` is the token that actually flips under `.dark`.
- **Don't reach for `--spacing(6)` here.** It is a Tailwind *build-time* function, not a CSS variable. With no theme in scope it hard-errors — verbatim in 4.3.3: ``The --spacing(…) function requires that the `--spacing` theme variable exists, but it was not found.`` It *does* resolve under `@reference`, but that is the per-file re-run you came here to avoid. `calc(var(--spacing) * 6)` is the runtime equivalent and needs neither, since the main stylesheet emits `--spacing` into `:root`.

## Bare-channel tokens are completely dead

Why `--background: 0 0% 100%` kills the token outright — the compiled output:

```css
.bg-background     { background-color: var(--background); }             /* → "0 0% 100%" → invalid, dropped */
.bg-background\/30 { background-color: color-mix(in oklab, var(--background) 30%, transparent); }  /* also dead */
```

`hsl(var(--background))` is **not** the bug — a wrapped channel set is a complete colour, and it compiles to `color-mix(in oklab, hsl(var(--background)) 30%, transparent)`. The naked channels are the thing to hunt for.

## `group` / `peer` / `@container` need the marker class

`group-hover:*` requires `group` on the parent; `peer-focus:*` requires `peer` on a **preceding** sibling in the DOM.

Container queries have the same shape: `@sm:` / `@md:` need `@container` on an ancestor (it sets `container-type: inline-size`). The compiled rule carries no marker in the selector, so with no container ancestor the query simply never matches and the utility silently does nothing.

## `@md:` is a container query, not a breakpoint

`md:` is the **viewport** (`@media (width >= 48rem)`). `@md:` is the **container** (`@container (width >= 28rem)`). Different mechanism, different size — not interchangeable, and swapping one for the other changes what the layout responds to. Container queries are core in v4; the `@tailwindcss/container-queries` plugin is gone.

**The rule:** viewport variants for **page chrome** — the shell, whether a sidebar exists, nav visibility, marketing breakpoints. `@container` + `@md:` when a **reusable component must follow its slot** rather than the window: the same card at 320px in a sidebar and 900px in the main column.

Mark the slot (or the component root) with `@container`, which sets `container-type: inline-size`. Descendants query it — the marked element does not query itself. Nested slots: name it, or you query the nearest ancestor instead of the one you meant.

```html
<div class="@container/main">
  <div class="flex flex-col @md:flex-row @lg/main:gap-8">…</div>
</div>
```

`@max-md:` is the container max variant, `max-md:` the viewport one — same `@` trap.

Container units share that axis: `cqi` / `cqw` measure the container's inline size, so `text-[4cqi]` or `p-[2cqi]` scales a component with its slot. `cqh` / `cqb` **do not** — `container-type: inline-size` queries only the inline axis, so they fall back to the small viewport and quietly become `svh`. Compiled on 4.3.3, `h-[50cqh]` emits verbatim with exit 0 and no warning. Stay on the inline axis.

Do **not** convert page-level `md:`/`lg:` to `@md:`/`@lg:` during cleanup, and do not put `@container` on a full-bleed page wrapper as a "modern default." `container-type` is CSS containment on the inline axis; it can interact badly with percentage heights and sticky descendants, so verify in the browser rather than adding it speculatively.

## `h-screen` ignores mobile browser chrome

Use `h-dvh` (dynamic viewport height) for full-height mobile layouts.

## Dynamic class names are never generated

`bg-${color}-500` won't exist in the output — the scanner reads source as plain text and never evaluates JS. Fix: use complete literal class strings (a prop → full-classname map).

When the values are genuinely runtime (CMS/theme API), force-generate them with v4's `safelist` replacement:

```css
@source inline("{hover:,}bg-{red,blue,amber}-{50,{100..900..100},950}");
```

Keep the set tight — every listed combination is emitted.

## `truncate` inside a flex/grid item needs `min-w-0`

`truncate` on a normal block element already clips at the container width — it needs nothing extra. The real trap is a flex or grid **item**: its `min-width: auto` refuses to shrink below content size, so the text overflows instead of ellipsing. Add `min-w-0` to the flex child (or `overflow-hidden` on it).

`line-clamp-*` is a different mechanism — it sets `-webkit-line-clamp` and needs the text to **wrap**, so never pair it with `truncate` or `whitespace-nowrap` (both force `white-space: nowrap`, leaving nothing to clamp). A width constraint is not the enemy here; it is what sets the wrap width.

## Arbitrary values

`bg-[#1da1f2]`, `w-[calc(100%-2rem)]`, `grid-cols-[200px_1fr]` (underscore = space). Prefer a token when the value repeats — see the ladder in SKILL.md.

## `!` important

`mt-4!` is a specificity band-aid — fix the real conflict instead.

To force *every* utility important — only when rescuing a codebase fighting high-specificity legacy CSS — the flag goes on the import, never in a config:

```css
@import "tailwindcss" important;
```

## A v3 entry file fails silently

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

This does **not** error in v4 — it exits 0. `base` and `components` emit nothing, and `utilities` runs with no theme and no Preflight, so only theme-independent utilities survive. Verified on 4.3.3 against `flex p-4 bg-red-500`, the entire output is `.flex { display: flex }` — `p-4` and `bg-red-500` are not generated at all, broken or otherwise. **The tell is `flex` working while `p-4` does nothing.** Replace the trio with `@import "tailwindcss";`.

## Mobile-first breakpoints

Unprefixed applies everywhere; `md:` is md **and up**, never "only md". `sm` is 40rem and `md` 48rem, both emitted as `width >=`, so `sm:hidden md:block` reads: **visible below `sm`** (neither rule matches), hidden from `sm` to `md`, shown md+. Reason it through at three widths before trusting a shorthand like "hidden on small".
