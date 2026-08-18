# Project setup — globals.css, theming, helpers

Read this when scaffolding a project, when there is no `globals.css` / no `@theme` block yet, or when adding the theme toggle or the `cn()` helper for the first time.

Contents:

- globals.css scaffold
- Build entry (PostCSS / Vite, `@utility`, `@config`)
- Theme toggle (next-themes)
- `dark:` in vendored shadcn primitives
- The `cn()` class merger — **ask the user**
- Interaction affordances: `cursor-pointer` — **ask the user**

## globals.css

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
}

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground; }
}
```

**Why `@theme inline` and not plain `@theme`.** `inline` makes the generated utility emit `var(--background)` directly instead of `var(--color-background)`. Without it, resolution follows the *parent* scope and a `.dark` override can be ignored — `inline` is what makes runtime theme flipping work, not a stylistic choice. Tailwind's docs describe the resolution trap in general terms; shadcn's default theme is what applies it to the light/dark pair, and this scaffold matches shadcn's output.

Two token pairs are easy to leave out and expensive to miss. **`--popover` / `--popover-foreground`** are used by Popover, Dialog, DropdownMenu, Select, Command and Tooltip — omitted, `bg-popover` is a silent no-style in a class attribute and a hard *"Cannot apply unknown utility class"* under `@apply`. **`--radius-xl`** is used by Card; without it `rounded-xl` silently falls back to Tailwind's stock 0.75rem instead of tracking `--radius`.

**On the two `.dark` tokens with baked-in alpha.** `--border: oklch(1 0 0 / 10%)` and `--input: oklch(1 0 0 / 15%)` are shadcn's real values and are the deliberate exception to "keep theme tokens opaque" — a hairline that must read as a *tint of the surface underneath* has nowhere else to put its alpha. Leave them. Every other token stays opaque, with the fade applied at the utility.

## Build entry

The v4 PostCSS plugin is `@tailwindcss/postcss`, and it is the only plugin needed — `postcss-import` and `autoprefixer` must be **removed**, not kept alongside it:

```js
// postcss.config.mjs
export default { plugins: { "@tailwindcss/postcss": {} } }
```

On Vite, skip PostCSS entirely and use `@tailwindcss/vite`.

Prefixing is done by Lightning CSS, not Autoprefixer, and it targets Chrome 111 / Safari 16.4 / Firefox 128 — a fixed modern floor that ignores `browserslist`. A project that needs older browsers has not gained automatic prefixing; it has lost the ability to configure it. That is a real constraint to raise with the user, not something to paper over.

Custom utilities go in `@utility`, never `@layer utilities`:

```css
@utility content-auto { content-visibility: auto; }
```

`@layer utilities { .content-auto { … } }` still emits the plain class, so it looks like it worked — but the utility is not registered, and `hover:content-auto` / `lg:content-auto` will not exist. `@layer base` and `@layer components` remain legitimate (the scaffold above uses `@layer base`).

A `tailwind.config.js` is **not auto-detected** in v4. If one genuinely must exist (a legacy JS plugin mid-migration, JS-computed tokens), load it explicitly and know what is dropped:

```css
@config "../../tailwind.config.js";
```

`corePlugins`, `safelist` and `separator` are ignored from there — safelisting moved to `@source inline(...)`. For a plain JS plugin, prefer `@plugin "@tailwindcss/typography";` over reintroducing a config file at all.

## Theme toggle

```tsx
import { ThemeProvider } from "next-themes"

<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  {children}
</ThemeProvider>
```

`attribute="class"` toggles `.dark` on `<html>`, which is what `@custom-variant dark (&:is(.dark *))` keys off. Defaults to system, user can override.

## `dark:` in vendored shadcn primitives

Leave it. The no-`dark:` rule governs **app-authored** code. Shadcn's generated `components/ui/*` keep their `dark:` **by design**: nearly all of it is **per-theme opacity on the same color** (`bg-input/30` → `dark:bg-input/50`, `bg-destructive/10` → `dark:/20`). Tokens can't replace this — v4 removed `bg-opacity-*`, the `/N` modifier *is* color-alpha but doesn't flip per theme on its own, and `opacity-*` fades the whole element (children included). Editing primitives to strip `dark:` adds indirection and upstream drift for no gain.

For genuine per-theme opacity in app code, avoid `dark:` — put the alpha in a variable that flips:

```css
:root { --alpha-fill: 0%; }
.dark { --alpha-fill: 30%; }
```
```tsx
<div className="bg-input/(--alpha-fill)" />  {/* color-mix() with a per-theme alpha, no dark: */}
```

## The `cn()` class merger

Standard helper (`clsx` + `tailwind-merge`):

```ts
// lib/utils.ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
```

When setting up a project's `cn` util for the first time, **ask which implementation to use** — recommend the standard combo above for stability, and add the alternative only if the user opts in. The alternative is [`cnfast`](https://github.com/aidenybai/cnfast) (`export { cn } from "cnfast"`), which fuses both into one `cn()` with **byte-identical output** (verified across 113k call groups) at a vendor-benchmarked ~3.8× speed for ~1 KB more gzipped. It is v0.1.0 — treat the speed claim as unvalidated; the correctness parity is the safe part.

## Interaction affordances — `cursor-pointer`

v4's Preflight makes `<button>` use `cursor: default`, and **the shadcn Button ships no `cursor-pointer`** (verified: `buttonVariants` has only `disabled:pointer-events-none`). Shadcn made pointer opt-in via `npx shadcn init --pointer`, which writes a global base rule.

**On a new project (or the first time adding buttons), ask the user whether to restore the pointer cursor — recommend yes, but don't add it unprompted.** If they accept, add the same rule `--pointer` writes:

```css
@layer base {
  button:not(:disabled),
  [role="button"]:not(:disabled) { cursor: pointer; }
}
```

This covers shadcn buttons, native `<button>`s, and `role="button"` alike, and skips disabled.
