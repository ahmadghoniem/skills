# Cleanup pass

Read and follow this when the user asks to clean / audit / simplify Tailwind classes, or when reviewing a component where class drift is clearly the subject. Do not improvise a pass from memory.

## Process

1. Read the target file(s).
2. For each element's class list, apply the rules below.
3. **Auto-apply** the safe mechanical fixes directly (edit the file).
4. **Flag** the judgment calls as candidates — never auto-change them.
5. Report using the output format at the bottom.
6. If the project has `eslint-plugin-better-tailwindcss` configured (see `references/editor.md`), run `npx eslint --fix` on the touched files afterwards to catch canonical-syntax residue. Read its output — don't assume exit 0 means clean.

## Auto-apply (safe, unambiguous)

- `flex flex-row` → `flex` (row is the default).
- `px-N py-N` (same N) → `p-N`; `mx-N my-N` → `m-N`; all four `pt/pb/pl/pr` equal → `p-N`.
- `w-N h-N` (same N) → `size-N`.
- Exact duplicate classes → keep one (same class twice, byte-identical).
- No-op default values → remove (`opacity-100`, `scale-100`, `rotate-0`, `translate-x-0 translate-y-0`, `order-0`, `basis-auto`).
- Decimal opacity → percentage (`bg-primary/[0.07]` → `bg-primary/7`).
- Arbitrary px on the 4px scale → the scale step (`p-[4px]` → `p-1`, `p-[8px]` → `p-2`, `p-[16px]` → `p-4`); `p-[1px]` → `p-px`. Leave `-px` utilities untouched.

## Flag as candidates (never auto-swap)

**Two classes setting the same property**
- `w-full w-32`, `text-sm text-lg`, `p-2 p-4` — flag the pair, ask which was intended. **Do not "keep the last one written."** Markup order does not decide the winner; the order Tailwind emits the rules does, and that order is not the order you wrote them. Verified in 4.3.3: `.w-32` is emitted *before* `.w-full`, so **`w-full` wins**; `.text-lg` before `.text-sm`, so **`text-sm` wins**. Spacing is the one that looks intuitive only because the scale sorts ascending — `p-4` beats `p-2` whichever order you write them in.
- If the class list is built through `cn()` / `tailwind-merge`, last-in-string *does* win — because the merger drops the loser before it ever reaches CSS. So the correct answer depends on whether the string is merged at runtime. Check before touching it.

**Token drift → semantic tokens**
- `bg-white` / `bg-gray-50/100` → `bg-background` or `bg-card`
- `text-gray-500/600` → `text-muted-foreground`; `text-gray-900` → `text-foreground`
- `border-gray-*` → `border-border`; raw `ring-*` / `outline-*` → `ring-ring`
- hand-rolled `bg-white dark:bg-gray-900` pairs → one token (`bg-background`)

**Colour format**
- hex / `rgb()` / `hsl()` in `:root`, `.dark`, or `@theme` → convert to `oklch()`. Convert **values only** — leave `currentColor`, CSS keywords, gradient interpolation, and third-party library configs alone. Use a converter; never compute the numbers by hand.
- a token defined as **bare channels** (`--background: 0 0% 100%`) → v3-shaped and completely dead: `bg-background` emits `background-color: var(--background)` → `0 0% 100%` → invalid, dropped. Not just the `/opacity` forms — the token does nothing at all. Flag as a migration, not a one-line swap.
- `hsl(var(--x))` on its own is **not** a defect — it is a complete colour, `/opacity` works against it, and it is shadcn's own prescribed v4 shape. Convert it to `oklch()` for house style, not because it is broken.
- a `/ A` alpha baked into a `:root` / `.dark` token → usually should be opaque, with the fade applied at the utility (`bg-primary/30`). **Exception: leave shadcn's dark hairlines** (`--border: oklch(1 0 0 / 10%)`, `--input: … / 15%`) — those are shipped values where the alpha *is* the colour.

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
- dynamic class names (`bg-${x}-500`) — never generated
- `truncate` inside a flex/grid item with no `min-w-0` — `min-width: auto` stops it shrinking, so it overflows instead of clipping

## Never touch

- Responsive (`sm: md: lg: xl: 2xl:`) and state (`hover: focus: active: group-* peer-*`) variants.
- `dark:` in **vendored `components/ui/*`** — deliberate per-theme opacity (`bg-input/30` → `dark:/50`), leave it. In **app code**, a hand-rolled `dark:` color pair is instead a candidate → fold into a token (see token drift above).
- Arbitrary values that are clearly intentional (including `-px` utilities).
- **`[&:hover]:` — never "canonicalise" it to `hover:`.** The named variant also wraps `@media (hover: hover)`, so this changes the CSS.
- **The v3→v4 rename table, on v4 code.** `shadow`, `rounded`, `ring`, `outline-none` are all valid v4 classes. Never remap them to `shadow-sm` / `rounded-sm` / `ring-3` / `outline-hidden` — `ring` is 1px in v4 and `ring-3` triples it; `rounded` is a hardcoded 0.25rem and `rounded-sm` is `var(--radius-sm)`, so the geometry changes.
- **`shadow-sm`, `blur-sm`, `rounded-sm`, `drop-shadow-sm`, `backdrop-blur-sm` — never rewrite these to `-xs`.** The rename moved *v3's* `shadow-sm` to `shadow-xs`; it did not delete `shadow-sm`, which in v4 is its own utility with its own value. Rewriting shrinks every shadow, blur and radius by one step. (The smallest shadow in v4 is `shadow-2xs`.)
- `data-[foo=bar]:` / `aria-[selected]:`, `[figure>&]:`, `has-[&>…]:`, multi-attribute selectors, `:where()` wrappers — no named equivalent, or a different selector.
- Classes used for JS targeting (check for `id=` / `data-*` on the element first).
- Anything inside a `class:list` or dynamic class binding — flag, don't edit.
- Preserve the order of the retained classes; don't reorder.

## Output format

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

For colour changes specifically, use a Before / After table and include **every** value changed, not a subset:

```
| Token | Before | After |
| --- | --- | --- |
| `--primary` | `#0f172a` | `oklch(0.205 0 0)` |
```
