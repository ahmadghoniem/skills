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
- **`--spacing(6)` will not work here.** It is a Tailwind *build-time* function, not a CSS variable — in an unprocessed block it hard-errors (`The --spacing(…) function requires that the --spacing theme variable exists`). `calc(var(--spacing) * 6)` is the runtime equivalent, since the main stylesheet emits `--spacing` into `:root`.

## Bare-channel tokens are completely dead

The v3 shape was `--background: 0 0% 100%` — three naked channels, meaningless on their own. In v4 that token does nothing at all:

```css
.bg-background     { background-color: var(--background); }             /* → "0 0% 100%" → invalid, dropped */
.bg-background\/30 { background-color: color-mix(in oklab, var(--background) 30%, transparent); }  /* also dead */
```

Not just the `/opacity` forms — **every** use of the token. Fix: store the complete colour (`--background: oklch(1 0 0)`) and bridge with `@theme inline`.

**`hsl(var(--background))` is not the bug.** A wrapped channel set is a complete colour, so it works, `/opacity` included — it compiles to `color-mix(in oklab, hsl(var(--background)) 30%, transparent)`. This is shadcn's own prescribed v4 migration shape. Convert it to `oklch()` because the house style says so, not because it is broken. The naked channels are the thing to hunt for.

## `group` / `peer` / `@container` need the marker class

`group-hover:*` requires `group` on the parent; `peer-focus:*` requires `peer` on a **preceding** sibling in the DOM.

Container queries have the same shape: `@sm:` / `@md:` need `@container` on an ancestor (it sets `container-type: inline-size`). The compiled rule carries no marker in the selector, so with no container ancestor the query simply never matches and the utility silently does nothing.

## `@md:` is a container query, not a breakpoint

`md:` is the **viewport** (`@media (width >= 48rem)`). `@md:` is the **container** (`@container (width >= 28rem)`). Different mechanism, different size — they are not interchangeable, and swapping one for the other changes what the layout responds to. Viewport breakpoints remain the right default for page layout; reach for `@container` when a component must respond to its parent's width regardless of where it is placed.

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

`line-clamp-*` is a different mechanism — it clamps *lines*, requires the text to wrap, and never wants a width constraint or `whitespace-nowrap`.

## Arbitrary values

`bg-[#1da1f2]`, `w-[calc(100%-2rem)]`, `grid-cols-[200px_1fr]` (underscore = space). Prefer a token when the value repeats — see the ladder in SKILL.md.

## `!` important

`mt-4!` is a specificity band-aid — fix the real conflict instead. v4's canonical marker is the **suffix** (`mt-4!`); the v3 prefix `!mt-4` still parses and is rewritten for you, so it is non-canonical, not broken.

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

This does **not** error in v4. Only `@tailwind utilities` is still honoured, so the build succeeds and emits utilities — with no Preflight and no theme variables, leaving every `bg-background`-style token dead. A build that "works" but renders unstyled is this. Replace the trio with `@import "tailwindcss";`.

## Mobile-first breakpoints

Unprefixed applies everywhere; `md:` applies at md **and up**. `sm:hidden md:block` = hidden on small, shown md+ (not "only md").
