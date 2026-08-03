---
name: tailwind
description: This skill should be used when writing, reviewing, or cleaning up Tailwind CSS. It provides a Tailwind v4 house style (the shadcn semantic-token system) and a class-list cleanup pass, applied while authoring or editing Tailwind and run on request ("clean up my tailwind", "audit these classes"). Tailwind v4 only — never emit v3 patterns.
---

# Tailwind (v4 + shadcn tokens)

Two jobs in one skill:

1. **Reference (always-on).** When authoring or editing Tailwind, follow the house style and avoid the gotchas below.
2. **Cleanup (on request).** When asked to clean/audit/simplify Tailwind classes, run the cleanup pass.

**Hard rule: this is Tailwind v4 only.** Never emit v3 patterns — no `tailwind.config.js` as the default, no `content`/purge array, no `darkMode: 'class'` config, no `require()` plugin syntax. If a project genuinely needs v3, say so explicitly first.

---

## House style: the shadcn token system

Dark mode and color are driven by **semantic CSS-variable tokens**, not raw color utilities. Author with `bg-background`, `bg-card`, `bg-primary`, `text-muted-foreground`, `border-border` — the variable flips under `.dark`, so `dark:` prefixes are rare.

### Project setup (`app/globals.css`)

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
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
}

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
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

### The theme toggle (`next-themes`, class strategy)

```tsx
import { ThemeProvider } from "next-themes"

<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  {children}
</ThemeProvider>
```

`attribute="class"` toggles `.dark` on `<html>`, which is what `@custom-variant dark (&:is(.dark *))` keys off. Defaults to system, user can override.

### `dark:` in vendored shadcn primitives — leave it

The no-`dark:` rule governs **app-authored** code. Shadcn's generated `components/ui/*` keep their `dark:` **by design**, and that's correct: nearly all of it is **per-theme opacity on the same color** (`bg-input/30` → `dark:bg-input/50`, `bg-destructive/10` → `dark:/20`). Tokens can't replace this — v4 removed `bg-opacity-*`, the `/N` modifier *is* color-alpha but doesn't flip per theme on its own, and `opacity-*` fades the whole element (children included). So editing primitives to remove `dark:` adds indirection and upstream drift for no gain.

For genuine per-theme opacity in app code, avoid `dark:` — put the alpha in a variable that flips:

```css
:root { --alpha-fill: 0%; }
.dark { --alpha-fill: 30%; }
```
```tsx
<div className="bg-input/(--alpha-fill)" />  {/* color-mix() with a per-theme alpha, no dark: */}
```

### The `cn()` class merger

Standard helper (`clsx` + `tailwind-merge`):

```ts
// lib/utils.ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
```

When setting up a project's `cn` util for the first time, ask which implementation to use — recommend the standard combo above for stability, and add the alternative only if the user opts in. The alternative is [`cnfast`](https://github.com/aidenybai/cnfast) (`export { cn } from "cnfast"`), which fuses both into one `cn()` with **byte-identical output** (verified across 113k call groups) at a vendor-benchmarked ~3.8× speed for ~1 KB more gzipped. It is v0.1.0 — treat the speed claim as unvalidated; the correctness parity is the safe part.

### Interaction affordances — `cursor-pointer` (v4 Preflight)

v4's Preflight makes `<button>` use `cursor: default`, and **the shadcn Button ships no `cursor-pointer`** (verified: `buttonVariants` has only `disabled:pointer-events-none`). Shadcn made pointer opt-in via `npx shadcn init --pointer`, which writes a global base rule.

**When invoking this skill on a new project (or first time adding buttons), ask the user whether to restore the pointer cursor — recommend yes, but don't add it unprompted.** If they accept, add the same rule `--pointer` writes:

```css
@layer base {
  button:not(:disabled),
  [role="button"]:not(:disabled) { cursor: pointer; }
}
```

This covers shadcn buttons, native `<button>`s, and `role="button"` alike, and skips disabled.

### Authoring rules

- Reach for a **semantic token** before any raw color. `bg-background`/`bg-card` for surfaces, `text-foreground`/`text-muted-foreground` for text, `border-border` for borders, `bg-primary`/`bg-destructive` for intent.
- Because tokens flip under `.dark`, `dark:` is rarely needed. A hand-rolled `bg-white dark:bg-gray-900` pair is a smell — use `bg-background`.
- Set radius via `rounded-md`/`rounded-lg` (bound to `--radius`), not arbitrary `rounded-[6px]`.
- Reserve raw colors for a deliberate one-off accent outside the palette — and even then prefer adding a token.
- **Arbitrary values are the model's fallback, not a neutral choice.** An agent writes Tailwind syntax fluently but has no knowledge of the project's `@theme`, and faces thousands of equally-valid utilities with no signal which is "blessed" — so it emits the most literal value that hits the target (`p-[17px]`, `bg-[#3b82f6]`, even `padding:'16px'`). Unchecked, these become "a shadow scale nobody owns." Before writing a bracket, walk the ladder:
  1. **Native scale step?** Use the token — spacing on the 4px grid (`p-1`=4px … `p-4`=16px; `p-px`=1px), `rounded-md`, `z-40`, `opacity-70`, `text-sm`. Never `p-[16px]` for `p-4`.
  2. **A colour?** Walk the colour ladder:
     - **Has a role** (surface, text, border, primary/brand, destructive, muted, ring, a chart series that themes) → use the semantic `@theme` token (`bg-primary`, `text-muted-foreground`). Never re-invent these with `bg-white` / `text-gray-500` / `dark:` pairs.
     - **Decorative, categorical, or a true one-off** with no role → soft-allow the nearest stock palette shade (`bg-sky-600`, `text-amber-500`). Match token count to the variability of the visual language — don't add a `@theme` token for a colour with no fixed meaning.
     - **Promote to `@theme`** once the colour carries brand meaning, must flip under `.dark`, or repeats in more than one place/file.
     - **Never a raw arbitrary colour** (`bg-[#3b82f6]`, `text-[rgb(...)]`) — snap to the nearest stop or extend the theme once; never scatter hex *and* grow a parallel shadow palette.
  3. **Value repeats (>1 place or file)?** Promote it to `@theme` and reference the generated token — Tailwind's own maintainer guidance.
  4. **Genuine one-off** (a `calc()`, a `grid-cols-[200px_1fr]` template, a single magic offset)? An arbitrary value is correct — that's the escape hatch. `-px` utilities count as intentional, not arbitrary.

  Enforce it where prose fails: a `no-arbitrary-value` lint rule in CI. Agents ignore guidance but can't ignore a failing build.
- **Treat `-px` utilities as intentional, not an escape hatch.** Keep `p-px`, `mt-px`, `gap-px`, `w-px` as-is; rewrite the long form `p-[1px]` → `p-px`. Bracket values that land on the 4px step map to the scale (`p-[4px]` → `p-1`, `p-[8px]` → `p-2`, `p-[16px]` → `p-4`); off-scale values (`p-[7px]`, `p-[13px]`) nudge to the nearest step.

---

## Editor setup — IntelliSense inside `cva`/`cn`

By default, Tailwind IntelliSense doesn't complete/lint class strings passed to helper functions like `cva()`, `tv()`, or `cn()`, or nested in a `cva` variant object. Register them so it does — add to `.vscode/settings.json`:

```jsonc
{
  // Needs a recent Tailwind CSS IntelliSense extension (the classFunctions setting).
  "tailwindCSS.classFunctions": ["cva", "cx", "cn", "clsx", "tv"]
}
```

Each entry is a regex matched against the function/tag name (matches are limited to the name); the extension then gives autocomplete, hover previews, and lint warnings for the class strings inside those calls — including cva's nested variants. The biggest wins are `cva`/`tv` (which hold the variant maps); `cn`/`clsx` mainly help their inline string args. These are editor settings, so v4's CSS-first config changes nothing here (reload the window after editing). On an older extension without `classFunctions`, fall back to `tailwindCSS.experimental.classRegex` with a `cva` tuple.

---

## Gotchas (v4)

Non-obvious traps to avoid when writing Tailwind:

- **`@apply` loses variants.** `@apply hover:bg-primary` does **not** work — variants are dropped. Keep `@apply` to base utilities only; put states in markup.
- **`@apply` in separately-bundled CSS needs `@reference`.** v4 resolves `@apply`/`theme()` against the theme in *that file's* compile context. Vue/Svelte `<style>` blocks, CSS Modules, and Astro `<style>` don't see the theme → "Cannot apply unknown utility class." Add `@reference "../app.css"` (or `@reference "tailwindcss"` for the default theme) at the top. But `@reference` re-processes the file every build (OOM at scale), so **prefer the CSS variables directly** in scoped blocks: `background: var(--color-primary); padding: --spacing(6); box-shadow: var(--shadow-md);` — zero processing, no `@reference`.
- **`group` / `peer` need the marker class.** `group-hover:*` requires `group` on the parent; `peer-focus:*` requires `peer` on a **preceding** sibling in the DOM.
- **`h-screen` ignores mobile browser chrome.** Use `h-dvh` (dynamic viewport height) for full-height mobile layouts.
- **Dynamic class names are never generated.** `bg-${color}-500` won't exist in the output — the scanner reads source as plain text and never evaluates JS. Fix: use complete literal class strings (a prop → full-classname map). When the values are genuinely runtime (CMS/theme API), force-generate them with v4's `safelist` replacement — `@source inline("{hover:,}bg-{red,blue,amber}-{50,{100..900..100},950}")` — and keep the set tight, since every listed combination is emitted.
- **`truncate` / `line-clamp-*` need a width constraint** (`max-w-*` or a sized flex/grid track) to actually clip.
- **Arbitrary values**: `bg-[#1da1f2]`, `w-[calc(100%-2rem)]`, `grid-cols-[200px_1fr]` (underscore = space). Prefer a token when the value repeats.
- **`!` important** (`!mt-4`) is a specificity band-aid — fix the real conflict instead.
- **Mobile-first**: unprefixed applies everywhere; `md:` applies at md **and up**. `sm:hidden md:block` = hidden on small, shown md+ (not "only md").

---

## Cleanup pass (on request)

Trigger on "clean up / audit / simplify my tailwind", or when reviewing a component where cleanup is clearly wanted.

### Process
1. Read the target file(s).
2. For each element's class list, apply the rules below.
3. **Auto-apply** the safe mechanical fixes directly (edit the file).
4. **Flag** the judgment calls as candidates — never auto-change them.
5. Report: a summary of what changed, per-element diffs, and the candidate list with suggested replacements.

### Auto-apply (safe, unambiguous)
- `flex flex-row` → `flex` (row is the default).
- `px-N py-N` (same N) → `p-N`; `mx-N my-N` → `m-N`; all four `pt/pb/pl/pr` equal → `p-N`.
- `w-N h-N` (same N) → `size-N` (native in v4).
- Exact duplicate classes → keep one.
- Overridden classes where one has no effect → keep the winner (`p-2 p-4` → `p-4`, `text-sm text-lg` → `text-lg`, `w-full w-32` → `w-32`).
- No-op default values → remove (`opacity-100`, `scale-100`, `rotate-0`, `translate-x-0 translate-y-0`, `order-none`, `basis-auto`).
- Decimal opacity → percentage (`bg-primary/[0.07]` → `bg-primary/7`).
- Arbitrary px on the 4px scale → the scale step (`p-[4px]` → `p-1`, `p-[8px]` → `p-2`, `p-[16px]` → `p-4`); `p-[1px]` → `p-px`. Leave `-px` utilities untouched.

### Flag as candidates (never auto-swap)

**Token drift → semantic tokens**
- `bg-white` / `bg-gray-50/100` → `bg-background` or `bg-card`
- `text-gray-500/600` → `text-muted-foreground`; `text-gray-900` → `text-foreground`
- `border-gray-*` → `border-border`; raw `ring-*` / `outline-*` → `ring-ring`
- hand-rolled `bg-white dark:bg-gray-900` pairs → one token (`bg-background`)

**Raw / arbitrary colors & off-scale values** (often intentional — nudge only)
- `bg-blue-600`, `text-red-500`, etc. **only when standing in for a themeable role** (surface / text / border / intent) → `bg-primary` / `bg-destructive`? Leave decorative one-off palette colours alone.
- arbitrary hex `bg-[#1da1f2]` → a token or `@theme` var?
- arbitrary radius `rounded-[6px]` → `rounded-md`?
- off-scale arbitrary px (`p-[7px]`, `p-[13px]`) → nearest scale step?

**Structural no-ops**
- `block` on a `<div>`, `inline` on a `<span>` (redundant unless a responsive reset)
- child `rounded-*` under a parent with `overflow-hidden` (may be intentional for focus rings)
- `leading-normal` with no competing leading

**v4 gotcha lint**
- `h-screen` → `h-dvh` (mobile chrome)
- `@apply` carrying `hover:`/`focus:`/etc. variants — broken in v4
- dynamic class names (`bg-${x}-500`) — never generated
- `truncate` / `line-clamp-*` with no width constraint — won't clip

### Never touch
- Responsive (`sm: md: lg: xl: 2xl:`) and state (`hover: focus: active: group-* peer-*`) variants.
- `dark:` in **vendored `components/ui/*`** — deliberate per-theme opacity (`bg-input/30` → `dark:/50`), leave it. In **app code**, a hand-rolled `dark:` color pair is instead a candidate → fold into a token (see token drift above).
- Arbitrary values that are clearly intentional (including `-px` utilities).
- Classes used for JS targeting (check for `id=` / `data-*` on the element first).
- Anything inside a `class:list` or dynamic class binding — flag, don't edit.
- Preserve the order of the retained classes; don't reorder.

### Output format
```
## path/to/Component.tsx

### Changes (applied)
- Line 4: flex-row removed (implicit in flex)
- Line 4: px-2 py-2 -> p-2
- Line 12: w-5 h-5 -> size-5

### Candidates (need confirmation)
- Line 8: bg-white dark:bg-gray-900 -> bg-background?
- Line 8: block on <div> — likely redundant
```
