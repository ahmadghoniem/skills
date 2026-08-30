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

**Don't hand-write a palette.** `npx shadcn@latest init` writes this file with a real theme and is the fastest correct path — run it and leave the values alone. Otherwise ask which theme to use (ui.shadcn.com/themes, tweakcn) and paste those values. Never overwrite an existing `:root` / `.dark` block with defaults.

What you *do* own is the wiring below — the bridge, the variant, the radius ladder, the base layer. Get these wrong and the theme silently doesn't flip. The role names below are shadcn's, which is the common case and what the rest of this skill's examples use; a project with its own vocabulary keeps it and the wiring is unchanged.

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
  /* shape only — a complete oklch(), contrast as a lightness gap with C untouched */
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  /* …every remaining role, values from the project's theme */
}

.dark {
  /* the same roles re-set for dark — never an inverted ramp */
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  /* …every remaining role */
}

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground; }
}
```

**Every role needs all three** — a `--color-*` bridge line, a `:root` value, and a `.dark` value. Missing from any one of them and the utility is dead. Current shadcn also ships `chart-1`…`chart-5`, the full `sidebar-*` set (`sidebar`, `-foreground`, `-primary`, `-primary-foreground`, `-accent`, `-accent-foreground`, `-border`, `-ring`), and `--radius-2xl` / `-3xl` / `-4xl` — bridge them too when the project uses charts or the sidebar.

Two are easy to leave out and expensive to miss. **`--popover` / `--popover-foreground`** are the overlay pair — Popover, DropdownMenu, ContextMenu, Select, Command, Combobox, HoverCard, Menubar and NavigationMenu content all paint with them. (**Dialog, Sheet, Drawer and AlertDialog do not** — they use `bg-background`; Tooltip uses `bg-foreground text-background`. Don't "fix" those to `bg-popover`.) Omit the pair and `bg-popover` is a silent no-style in a class attribute and a hard *"Cannot apply unknown utility class"* under `@apply`. **`--radius-xl`** is used by Card. `@theme inline` *extends* the default theme rather than replacing it, so any rung you don't bridge keeps Tailwind's stock value — compiled on 4.3.3, an unbridged `rounded-xl` emits 0.75rem and `rounded-2xl` 1rem while `rounded-lg` tracks `--radius`. The tell is one component whose corners don't move when `--radius` changes.

**Why `@theme inline` and not plain `@theme`.** `inline` makes the generated utility emit `var(--background)` directly instead of `var(--color-background)`. Without it, resolution follows the *parent* scope and a `.dark` override can be ignored — `inline` is what makes runtime theme flipping work, not a stylistic choice.

**Shadcn's `.dark` hairlines carry baked-in alpha** (`--border: oklch(1 0 0 / 10%)`, `--input: … / 15%`) — the deliberate exception to "keep theme tokens opaque", since a hairline that reads as a tint of the surface beneath it has nowhere else to put its alpha. Leave them as shipped; every other token stays opaque with the fade applied at the utility.

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

`@layer base` and `@layer components` remain legitimate (the scaffold above uses `@layer base`) — `@layer utilities` for a *custom utility* is the trap, and never registers it.

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
