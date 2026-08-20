---
name: tailwind
description: Tailwind CSS v4 house style: semantic tokens, OKLCH, canonical syntax. Use when writing or reviewing Tailwind, cleaning up class lists, fixing theme tokens, or when a utility silently isn't applying.
license: MIT
---

# Tailwind v4 (semantic tokens)

Two jobs in one skill:

1. **Author (always-on).** When writing or editing Tailwind, follow the house style below.
2. **Cleanup (on request).** When asked to clean/audit/simplify Tailwind classes, read `references/cleanup.md` and follow it.

**Hard rule: this is Tailwind v4 only.** Never emit v3 patterns — no `tailwind.config.js` as the default, no `content`/purge array, no `darkMode: 'class'` config, no `require()` plugin syntax, no `@tailwind base/components/utilities` (the entry point is `@import "tailwindcss";`), no `bg-opacity-*` / `text-opacity-*` / `border-opacity-*` (removed — use the `/50` modifier), and no `@layer utilities` for custom utilities (that is `@utility`). If a project genuinely needs v3, say so explicitly first.

---

## House style: semantic tokens

Dark mode and colour are driven by **semantic CSS-variable tokens**, not raw colour utilities. Tokens live as complete colour values in `:root` / `.dark`, bridged into utilities with `@theme inline`; the variable flips under the dark selector, so `dark:` prefixes are rare. Full scaffold in `references/setup.md`.

**Read the project's token names out of its CSS — never assume them.** Where there is no theme yet, shadcn's names are the default to scaffold (`background`/`foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`), and the examples below use them. A project with its own vocabulary keeps it; the pattern is the rule, the names are not.

## Colour values: OKLCH only

Both upstreams already work this way — shadcn's default theme ships OKLCH, and Tailwind v4's own palette is authored in OKLCH. Match them.

- **Every colour token is `oklch(L C H)` or `oklch(L C H / A)`.** No hex, `rgb()`, or `hsl()` in `:root`, `.dark`, or `@theme`. (L = perceived lightness 0–1, C = how vivid 0–~0.4, H = hue 0–360.)
- **Store the complete colour function.** Never v3-style bare channels (`--background: 0 0% 100%`). v4 utilities emit `var(--background)` straight into `background-color`, so naked channels are invalid and the token does nothing at all — with or without a `/opacity` modifier. (A wrapped `hsl(var(--background))` is a *complete* colour and works fine; convert it for house style, not because it is broken.)
- **Spaces, not commas; slash for alpha.** `oklch()` has no legacy comma form. Tailwind does **not** validate this — `oklch(0.7 0.1 250, 0.5)` passes through the build untouched and no warning appears; the *browser* drops the declaration at parse time. A green build is not evidence the colour works. Write `oklch(0.7 0.1 250 / 0.5)`, and omit the alpha when it is 1.
- **Keep theme tokens opaque.** Put transparency on the utility (`bg-primary/30`), not inside the token — otherwise the two compound into a double fade. The one standing exception is shadcn's dark-mode hairlines (`--border: oklch(1 0 0 / 10%)`, `--input: … / 15%`), where the alpha *is* the colour; leave those as shipped.
- **Every fill token has a paired `-foreground`,** and the contrast between them is a **lightness gap**.
- **Fix contrast by moving L.** Push L further from the background and leave C and H alone; then re-check the ratio. Never raise C to "add contrast" — on some hues it measurably *lowers* it.
- **If a colour looks wrong or over-saturated, lower C and keep L and H.** Not every `oklch()` triple is displayable; browsers substitute something nearby, and most still clip naively rather than reducing chroma for you. **Ceilings vary enormously by hue** — at L 0.55 the maximum in-gamut chroma runs from ~0.09 (cyan) to ~0.27 (purple), so there is no single safe number to memorise. Treat C ≤ 0.04 as the grey band and C ≤ 0.12 as comfortable for most accents; above that, copy a known-good value rather than inventing one. Vivid intent roles legitimately go higher — shadcn's own `--destructive` is `oklch(0.577 0.245 27.325)`.
- **Never compute OKLCH by hand.** Convert with a tool (oklch.fyi, `culori`) and paste the result. When converting an existing palette, convert the **values only** — leave `currentColor`, CSS keywords, gradient interpolation, and third-party library configs alone.
- **No brand ramp unless asked.** This system is ~12 semantic roles, not a 50–950 palette. And don't build dark mode by inverting a ramp — re-set the same semantic roles under `.dark`.

## Authoring rules

- Reach for a **semantic token** before any raw colour — a surface token for surfaces, a muted-text token for secondary text, a border token for borders, an intent token for primary/destructive. Under shadcn's names: `bg-background`/`bg-card`, `text-muted-foreground`, `border-border`, `bg-primary`/`bg-destructive`.
- Because tokens flip under the dark selector, `dark:` is rarely needed. A hand-rolled `bg-white dark:bg-gray-900` pair is a smell — use the surface token.
- **Read what consumes a token before editing it.** Names state intent, not binding: grep the `bg-*` / `text-*` / `border-*` on the component and change *that* token. Recolouring `--sidebar-primary` does nothing when the item paints with `data-active:bg-sidebar-accent`. And a token is a **role** — editing one restyles everything bound to it, so changing `--primary` for a button also repaints every default badge.
- **Check the live docs before asserting a version-specific fact** — a utility's default value, a CLI flag, a plugin's rule or option name. Training data lags releases and the mistakes are silent.
- Set radius via `rounded-md`/`rounded-lg` (bound to `--radius`), not arbitrary `rounded-[6px]`.
- **Arbitrary values are the model's fallback, not a neutral choice.** An agent writes Tailwind syntax fluently but has no knowledge of the project's `@theme`, and faces thousands of equally-valid utilities with no signal which is "blessed" — so it emits the most literal value that hits the target (`p-[17px]`, `bg-[#3b82f6]`, even `padding:'16px'`). Unchecked, these become "a shadow scale nobody owns." Before writing a bracket, walk the ladder:
  1. **Native scale step?** Use the token — spacing on the 4px grid (`p-1`=4px … `p-4`=16px; `p-px`=1px), `rounded-md`, `z-40`, `opacity-70`, `text-sm`. Never `p-[16px]` for `p-4`.
     **The spacing scale is unbounded** — every integer works, compiling to `calc(var(--spacing) * N)`. `p-18`, `mt-21`, `gap-13`, `w-101` are all real, as are open-ended `z-N` and `grid-cols-N`. Never reach for a bracket because a number "looks too big for the scale": divide by 4 and use the step. For the same reason, never add `--spacing-18: 4.5rem` to `@theme` — `p-18` already *is* 4.5rem. Named `--spacing-*` keys are for names (`--spacing-gutter`), not for filling holes in a scale that has none.
  2. **A colour?** Walk the colour ladder:
     - **Has a role** (surface, text, border, primary/brand, destructive, muted, ring, a chart series that themes) → use the semantic `@theme` token (`bg-primary`, `text-muted-foreground`). Never re-invent these with `bg-white` / `text-gray-500` / `dark:` pairs.
     - **Decorative, categorical, or a true one-off** with no role → soft-allow the nearest stock palette shade (`bg-sky-600`, `text-amber-500`). Match token count to the variability of the visual language — don't add a `@theme` token for a colour with no fixed meaning.
     - **Promote to `@theme`** once the colour carries brand meaning, must flip under `.dark`, or repeats in more than one place/file.
     - **Never a raw arbitrary colour** (`bg-[#3b82f6]`, `text-[rgb(...)]`) — snap to the nearest stop or extend the theme once; never scatter hex *and* grow a parallel shadow palette.
  3. **Value repeats (>1 place or file)?** Promote it to `@theme` and reference the generated token — Tailwind's own maintainer guidance.
  4. **Genuine one-off** (a `calc()`, a `grid-cols-[200px_1fr]` template, a single magic offset)? An arbitrary value is correct — that's the escape hatch. `-px` utilities count as intentional, not arbitrary.
- **Treat `-px` utilities as intentional, not an escape hatch.** Keep `p-px`, `mt-px`, `gap-px`, `w-px` as-is; rewrite the long form `p-[1px]` → `p-px`. Bracket values that land on the 4px step map to the scale (`p-[4px]` → `p-1`, `p-[8px]` → `p-2`, `p-[16px]` → `p-4`); off-scale values (`p-[7px]`, `p-[13px]`) nudge to the nearest step.
- **Get the two custom-CSS directives right — both have a v3/beta lookalike.**
  - A custom utility is `@utility name { … }`. `@layer utilities { .name { … } }` still emits the class, so it *looks* like it worked, but the utility is never registered and `hover:name` / `lg:name` won't exist.
  - A custom variant is **`@custom-variant`**: `@custom-variant theme-midnight (&:where([data-theme="midnight"] *));`. `@variant` is a different directive that *applies* an already-registered variant inside CSS (`.x { @variant dark { … } }`). Defining with `@variant name (selector)` is v4-**beta** syntax — it is still silently accepted for compatibility, so it will not error, it will just be undocumented and ambiguous.

### Canonical syntax

Training data is full of v3 and of verbose arbitrary variants. Emit the first-class form:

| Instead of | Write | |
| --- | --- | --- |
| `[&>*]:` / `[&_*]:` | `*:` / `**:` | direct children / all descendants |
| `[&>[role=checkbox]]:` | `*:[[role=checkbox]]:` | outer `[]` = arbitrary variant, inner `[]` = the attribute selector |
| `[&>[data-open]]:` | `*:data-open:` | `data-*` / `aria-*` are first-class |
| `[&:has(...)]:` `[&:not(:first-child)]:` `[&:nth-child(odd)]:` | `has-[...]:` `not-first:` `odd:` | |
| `group-[.foo]:` | `group-hover:` / `peer-invalid:` | only when a **named state variant** exists; a class-qualified group is otherwise fine |
| `[@media_print]:` / `[@media(width>=…)]:` | `print:` / `lg:` / `max-lg:` | |
| `!flex` | `flex!` | v4's marker is the suffix; the prefix still parses, so it is non-canonical, not broken |
| `bg-[--token]` / `bg-[var(--token)]` | `bg-(--token)` | same for modifiers: `bg-primary/(--alpha)` |
| `grid-cols-[auto,1fr]` | `grid-cols-[auto_1fr]` | underscore is the space; no padding underscores |
| `bg-gradient-to-r` `flex-grow` `overflow-ellipsis` `break-words` `decoration-clone` `bg-left-top` | `bg-linear-to-r` `grow` `text-ellipsis` `wrap-break-word` `box-decoration-clone` `bg-top-left` | v3 names |

**A component library can redefine these variant names.** `shadcn/tailwind.css` ships its own `@custom-variant data-open` matching `[data-state="open"]` *and* `[data-open]`, plus `data-closed` / `data-checked` / `data-selected` / `data-disabled` / `data-active` / `data-horizontal` / `data-vertical`. Where it is imported those are broader than stock Tailwind's — read the project's CSS before assuming `data-x:` means the bare attribute.

Fewer classes, same result:

- **Collapse same-value sides.** `size-4` over `w-4 h-4`; `p-4` over `px-4 py-4`; `m-4` over four sides; `inset-0` over four offsets; `text-sm/7` over `text-sm leading-7`.
- **Don't restate a default.** `flex flex-row` is just `flex` (row is the default). Same for `opacity-100`, `scale-100`, `rotate-0`, `order-0`, `basis-auto` — emitting them adds a class that changes nothing.
- **Don't emit two classes that set the same property.** Write the one you mean. When you find a pair in existing code, do not assume the last one written wins — that is decided by Tailwind's emission order, not markup order (see `references/cleanup.md`).

**Do not over-correct.** These are already right, and "fixing" them changes behaviour or is plainly wrong:

- `[&:hover]:` is **not** the same as `hover:` — the named variant also wraps `@media (hover: hover)`. Only use `hover:` when you mean that.
- **Never apply the v3→v4 rename table to v4 code.** `shadow`, `rounded`, `ring`, `outline-none` are all valid v4 classes; remapping them to `shadow-sm` / `rounded-sm` / `ring-3` / `outline-hidden` changes the render (v4 `ring` is 1px, so `ring-3` triples it) or is a pointless no-op rename.
- **Never rewrite `shadow-sm` / `blur-sm` / `rounded-sm` / `drop-shadow-sm` / `backdrop-blur-sm` to `-xs`.** The rename moved *v3's* `shadow-sm` to `shadow-xs`; it did not delete `shadow-sm`, which is its own v4 utility with its own value. Doing this shrinks every shadow, blur and radius by one step. (v4's smallest shadow is `shadow-2xs`.)
- **Don't convert viewport variants into container queries.** `md:`/`lg:` and `@md:`/`@lg:` are both first-class and mean different things. Viewport is the default for page chrome; reach for `@container` when authoring a component that will live in more than one slot width. See `references/gotchas.md`.
- **Keep a stacked `data-active:hover:`** — it is how a selected state survives hover. A library variant wrapped in `:where()` (shadcn's are) contributes *zero* specificity, so `data-active:bg-accent` lands at (0,1,0) and plain `hover:bg-accent/50` at (0,2,0) repaints the active item every time; the stacked form restores it. Three classes, none redundant — see `references/cleanup.md`.
- Keep `data-[foo=bar]:` and `aria-[selected]:` — an operator or a presence check is not the named `data-foo:` variant.
- Keep `[figure>&]:` (`in-*` is descendant, not child), `has-[&>[data-x]]:`, multi-attribute selectors, `:where()` wrappers, and any selector with no named equivalent. Arbitrary variants are the escape hatch.

Prose prevents; a linter catches the residue. Where the project has one configured, finish an editing pass with `npx eslint --fix` — see `references/editor.md`.

---

## When to load more

- **Scaffolding a project** — no `globals.css`, no `@theme` block, wiring the PostCSS/Vite entry, adding the theme toggle, or setting up `cn()` or the button cursor for the first time: read `references/setup.md` before writing CSS. It wires the token contract and leaves the palette values to `shadcn init` or the user; it carries three decisions that must be **asked, not assumed**.
- **A v4 trap** — a utility not applying, "Cannot apply unknown utility class", `@apply` in a Vue/Svelte/Astro `<style>` or CSS Module, `h-screen` on mobile, a dynamic `bg-${x}` class, `truncate` not clipping, container queries / `@md:` vs `md:`, or a token that looks v3-shaped: read `references/gotchas.md`.
- **Tooling** — editor autocomplete inside `cva`/`cn`, class sorting, or a lint rule to enforce this house style: read `references/editor.md`.
- **Cleanup / audit / simplify** — the user asked, or you are reviewing a component for class drift: read `references/cleanup.md` and follow its process and output format.
