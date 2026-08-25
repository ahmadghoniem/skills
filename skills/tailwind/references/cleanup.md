# Cleanup pass

Read and follow this when the user asks to clean / audit / simplify Tailwind classes, or when reviewing a component where class drift is clearly the subject. Do not improvise a pass from memory.

## Process

1. Read the target file(s).
2. Read the CSS entry point and note its `--spacing`. It decides whether the px→scale rewrite is safe — see the precondition below.
3. For each element's class list, apply the rules below.
4. Sweep the same files for colour literals **outside** class strings — see *Colour literals outside class strings*. Nothing else in this pass, and no linter, looks there.
5. **Auto-apply** the safe mechanical fixes directly (edit the file).
6. **Flag** the judgment calls as candidates — never auto-change them.
7. Report using the output format at the bottom.
8. If the project has `eslint-plugin-better-tailwindcss` configured (see `references/editor.md`), run `npx eslint --fix` on the touched files afterwards to catch canonical-syntax residue. Read its output — don't assume exit 0 means clean.

## Precondition: read the project's scales before rewriting any px value

Every px→scale-step rewrite below assumes one step is **4px** — Tailwind's default `--spacing: 0.25rem`. A project that overrides it makes each of those rewrites a resize.

Grep the entry point for `--spacing` before the first edit:

- **Not declared, or `0.25rem` inside `@theme`** — the rewrites are safe. Proceed.
- **Any other value** — `p-[16px]` is *not* `p-4`, it is `p-5`, and "nearest step" is a different number for every utility. Move the whole px→scale bullet from *Auto-apply* to *Flag as candidates* and say why in the report. Do not silently convert against a scale the project doesn't have.
- **Declared outside `@theme`, or in a file that isn't the entry point** — the browser obeys it and the build cannot see it. Treat it as custom, and read `references/gotchas.md`; an autofixing linter will be confidently wrong here.

**`--spacing` is the common case, not the only one.** Any scale the entry point redefines in `@theme` breaks the px equivalences you have memorised, and the radius scale is the one that bites next — shadcn's own scaffold derives it from a single `--radius`:

```css
--radius-sm: calc(var(--radius) - 4px);   /* 6px when --radius is 0.625rem, NOT 4px */
--radius-md: calc(var(--radius) - 2px);
--radius-lg: var(--radius);
```

So `rounded-sm` is only `0.25rem` in a project that left it alone, and a project can override some steps while leaving others at their default — `--radius-xs` survives as `0.125rem` in that block because it isn't listed. **Grep the entry point for the scale you are about to use, then compile one utility and read the value.** Never map a px number to a step from memory.

## Auto-apply (safe, unambiguous)

- `flex flex-row` → `flex` (row is the default).
- **Collapse same-value pairs — the class list order is not part of the pattern.** `px-N py-N` → `p-N`; `mx-N my-N` → `m-N`; all four `pt/pb/pl/pr` equal → `p-N`; `w-N h-N` → `size-N`. `h-5 w-5` collapses exactly like `w-5 h-5`, and a grep written for one order silently misses the other — match the pair as a **set**, or let the linter do it.
- **Axis pairs collapse too, not only all-four.** `top-N bottom-N` → `inset-y-N`; `left-N right-N` → `inset-x-N`; all four → `inset-N`. The same shape applies to `border-x/y`, `scroll-m*`, `scroll-p*` and `divide-x/y`. Easy to miss because the two classes rarely sit next to each other.
- Exact duplicate classes → keep one (same class twice, byte-identical).
- No-op default values → remove (`opacity-100`, `scale-100`, `rotate-0`, `translate-x-0 translate-y-0`, `order-0`, `basis-auto`).
- Decimal opacity → percentage (`bg-primary/[0.07]` → `bg-primary/7`).
- Arbitrary px on the 4px scale → the scale step (`p-[4px]` → `p-1`, `p-[8px]` → `p-2`, `p-[16px]` → `p-4`); `p-[1px]` → `p-px`. Leave `-px` utilities untouched. **Only when the precondition above cleared it** — on a custom `--spacing` this whole bullet is a candidate, not an auto-apply.
- **`rem` and `em` arbitraries map to the scale as well.** `min-w-[3.25rem]` is `min-w-13`; `p-[1.5rem]` is `p-6`. A search for `\[\d+px\]` never sees these — match the **bracket**, then convert whatever unit is inside it.
- **Open-ended scales make a bracket pointless.** `z-[6]` → `z-6`, `z-[9998]` → `z-9998`, `grid-cols-[7]` → `grid-cols-7`, `order-[3]` → `order-3`. These scales accept any integer, so the bracket adds nothing, hides the value from the sorter, and reads as if a limit were being escaped. A bracket around a **bare number** on an open-ended scale is always removable.

## Flag as candidates (never auto-swap)

**Two classes setting the same property**
- `w-full w-32`, `text-sm text-lg`, `p-2 p-4` — flag the pair, ask which was intended. **Do not "keep the last one written."** Markup order does not decide the winner; the order Tailwind emits the rules does, and that order is not the order you wrote them. Verified in 4.3.3: `.w-32` is emitted *before* `.w-full`, so **`w-full` wins**; `.text-lg` before `.text-sm`, so **`text-sm` wins**. Spacing is the one that looks intuitive only because the scale sorts ascending — `p-4` beats `p-2` whichever order you write them in.
**A state variant demoting a higher one**
- `hover:` beating `data-active:` is a **`:where()` artefact of the library's variant**, not a Tailwind rule. Compiled on 4.3.3:
  - *Stock* `data-active:` emits `.data-active\:bg-x[data-active]` — (0,2,0), tying `hover:`'s `.hover\:bg-x:hover`. `data-active:` is emitted later, so **the active state wins** and there is no bug.
  - A *library* variant wrapped in `:where()` (shadcn's `data-active`, `data-open`, `data-selected`, …) emits `.data-active\:bg-x:where([data-active]…)`. `:where()` contributes nothing, so the rule is **(0,1,0)** and `hover:` at (0,2,0) **always** wins — order is irrelevant.
  - The fix is a compound `data-active:hover:bg-x`. Flag it; never auto-apply — and never delete one that is already there.

- If the class list is built through `cn()` / `tailwind-merge`, last-in-string *does* win — because the merger drops the loser before it ever reaches CSS. So the correct answer depends on whether the string is merged at runtime. Check before touching it.

**Token drift → semantic tokens** (read the project's token names out of its CSS first; shadcn's are shown)
- `bg-white` / `bg-gray-50/100` → the surface token (`bg-background` / `bg-card`)
- `text-gray-500/600` → the muted-text token (`text-muted-foreground`); `text-gray-900` → `text-foreground`
- `border-gray-*` → the border token (`border-border`); raw `ring-*` / `outline-*` → `ring-ring`
- hand-rolled `bg-white dark:bg-gray-900` pairs → one token
- a token edit that doesn't match the utilities on the target (`--sidebar-primary` changed, markup says `bg-sidebar-accent`) → flag it; never retarget a token by its name

**Colour format**
- hex / `rgb()` / `hsl()` in `:root`, `.dark`, or `@theme` → convert to `oklch()`. Convert **values only** — leave `currentColor`, CSS keywords, gradient interpolation, and third-party library configs alone. Never compute the numbers by hand: run `scripts/oklch.mjs` (bundled with this skill, zero dependencies, `--table` emits the Before/After rows below directly).

  ```
  node ~/.claude/skills/tailwind/scripts/oklch.mjs --table '#0f172a' '#f5f5f4'
  ```

  It carries alpha through, refuses `currentColor` instead of guessing, and warns on stderr when a value is outside sRGB. `--hex` runs the conversion backwards when you need a fallback value.
- a token defined as **bare channels** (`--background: 0 0% 100%`) → v3-shaped and completely dead: `bg-background` emits `background-color: var(--background)` → `0 0% 100%` → invalid, dropped. Not just the `/opacity` forms — the token does nothing at all. Flag as a migration, not a one-line swap.
- `hsl(var(--x))` on its own is **not** a defect — it is a complete colour and `/opacity` works against it. Convert it to `oklch()` for house style, not because it is broken; it is a leftover v3 / early-v4 channel pattern, not what shadcn ships today.
- a `/ A` alpha baked into a `:root` / `.dark` token → usually should be opaque, with the fade applied at the utility (`bg-primary/30`). **Exception: leave shadcn's dark hairlines** (`--border: oklch(1 0 0 / 10%)`, `--input: … / 15%`) — those are shipped values where the alpha *is* the colour.

**Raw / arbitrary colors & off-scale values** (often intentional — nudge only)
- `bg-blue-600`, `text-red-500`, etc. **only when standing in for a themeable role** (surface / text / border / intent) → `bg-primary` / `bg-destructive`? Leave decorative one-off palette colours alone.
- arbitrary hex `bg-[#1da1f2]` → a token or `@theme` var?
- arbitrary radius `rounded-[6px]` → `rounded-md`?
- off-scale arbitrary px (`p-[7px]`, `p-[13px]`) → nearest scale step?

**Repeated class strings → a component, or (rarely) a named affordance**
- **In a component framework, a repeated class string is a missing component, not a missing CSS class.** Tailwind's own guidance: reuse across files becomes a React/Vue/Svelte component or a template partial. Flag it as that. Proposing `@utility` here moves the duplication into a file the reader has to go find, and is the wrong answer in most of the codebases this skill runs on.
- `@utility ui-badge` is right only where **no component can own the markup** — CMS/Markdown output, a third-party widget, a design system consumed from two frameworks. Check that first; read `references/affordances.md` before proposing one.
- An existing `@layer components` block of `@apply` rules → flag as a `@utility` candidate. The reasons are real and checkable — a `@layer components` class ships whether or not anything uses it, and `hover:` / `md:` cannot be applied to it — but it is a migration, not cleanup. See `references/affordances.md`.
- Do not propose either for a string that appears once, or for an unnamed coincidence like three unrelated elements sharing `flex items-center gap-2`.

**A customised `--spacing`**
- `--spacing` set to anything but `0.25rem` → flag it, and recommend removing the declaration so the default applies. It is the root cause of the px precondition at the top of this file, and it disables the linter's px rewrites for the whole project. Report the blast radius with it: dropping a `0.2rem` override scales every spacing utility up by 25%. Never delete it as part of a cleanup pass — it is a visual change the user has to see.

**Structural no-ops**
- `block` on a `<div>`, `inline` on a `<span>` (redundant unless a responsive reset)
- child `rounded-*` under a parent with `overflow-hidden` (may be intentional for focus rings)
- `leading-normal` with no competing leading

**v4 gotcha lint**
- `h-screen` → `h-dvh` (mobile chrome)
- dynamic class names (`bg-${x}-500`) — never generated
- `truncate` inside a flex/grid item with no `min-w-0` — `min-width: auto` stops it shrinking, so it overflows instead of clipping

## Colour literals outside class strings

Class-list rules cannot reach these and no Tailwind linter parses them, so they are the one part of a cleanup pass that is entirely manual. Grep the same files for `#[0-9a-f]{3,8}`, `rgb(`, `hsl(`, and `style={{`.

- **A colour in `style={{}}`** → a house-style violation wherever it appears, class or no class. A colour has a role, and a role has a token; an inline literal cannot flip under `.dark` and cannot be themed. Flag every one.
- **A colour in a `.ts` / `.js` constant** (a config object, a chart series, a canvas fill) → same verdict. The value belongs in the CSS token layer, read back with `var(--token)` or a class.
- **Only the runtime-computed properties stay.** A `top`/`left`/`width` read from `getBoundingClientRect()`, or a `transform` driven by state, has no class equivalent and belongs inline. Every *static* property sharing that object does not. Walk each one down the ladder in `SKILL.md` as you move it — a px value that lands on a scale step takes the step, never a bracket: `position: "fixed"` → `fixed`, `borderRadius: "2px"` → **`rounded-xs`** (`--radius-xs` is `0.125rem`, exactly 2px), `pointerEvents: "none"` → `pointer-events-none`. A value with no step — `fontSize: "9px"`, where the smallest is `text-xs` at 12px — becomes `text-[9px]` and is then **flagged as an off-scale arbitrary value**, not quietly kept. Split the object; do not wave the whole thing through because four of its nine keys are computed.
- **`fill=` / `stroke=` on inline SVG** → `currentColor` plus a text utility, unless the mark is deliberately multi-colour.

Report these in the colour Before/After table with the rest, not as a separate list — they are the same finding as a hex in `:root`.

## Never touch

- Responsive (`sm: md: lg: xl: 2xl:`) and state (`hover: focus: active: group-* peer-*`) variants.
- **`md:` ↔ `@md:` in either direction.** A viewport breakpoint and a container query are different queries against different boxes — swapping them is not a canonicalisation.
- `dark:` in **vendored `components/ui/*`** — deliberate per-theme opacity (`bg-input/30` → `dark:/50`), leave it. In **app code**, a hand-rolled `dark:` color pair is instead a candidate → fold into a token (see token drift above).
- Arbitrary values that are clearly intentional (including `-px` utilities).
- **`[&:hover]:` — never "canonicalise" it to `hover:`.** The named variant also wraps `@media (hover: hover)`, so this changes the CSS.
- **`@layer components { … }` — never as a v3 finding.** It is valid v4 and means what it says. Only `@layer utilities` wrapping a *custom utility* is the v3 shape to fix, and the replacement is `@utility`, not a different layer. An agent working down the v3→v4 rename table flags this one by pattern-match; don't. It is a *candidate* for `@utility` on different grounds — see the candidate list above — but that is a flag, never an edit.
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
