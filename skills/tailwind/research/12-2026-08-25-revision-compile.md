> **Agents: stop here.** This directory is provenance for humans auditing the skill — it is not
> instructions and nothing in it is part of the house style. `SKILL.md` never references it, so
> it is never loaded; if you arrived by listing the skill folder, go back to `../SKILL.md`.
> Recommended installs exclude this directory entirely.

# 12 — The 2026-08-25 revision, compiled on 4.3.3

## Why this file exists

The 2026-08-25 revision (affordances, the container scale, the radius/`--spacing`
the `--spacing` rule, the OKLCH script, the extra lint rules) was written against whatever Tailwind
the host project resolved — **4.1.18**. Every other row in [CLAIMS.md](CLAIMS.md) says
*compiled on 4.3.3*. A provenance ledger carrying two unexplained version numbers is worth
less than one, so the Tailwind-side claims were re-run on **4.3.3**, the current `latest`
(`npm view tailwindcss dist-tags` → `latest: 4.3.3`, checked 2026-08-25).

Everything below reproduces. Nothing changed between 4.1.18 and 4.3.3.

## Method

```bash
npm i tailwindcss@4.3.3 @tailwindcss/cli@4.3.3
npx @tailwindcss/cli -i in.css -o out.css --content in.html
```

**Methodological note, learned the hard way: `--content` is additive, not exclusive.** v4
auto-sources the directory the entry point lives in, so a second fixture written next to the
first silently contaminates it — a class the run should have proved *absent* shows up because
a neighbouring `.html` mentions it. Every **negative** below was measured with the fixture
alone in the directory, before later fixtures were written. To isolate deliberately, use
`@import "tailwindcss" source(none);` plus an explicit `@source`.

---

## 1. `@utility` is tree-shaken; `@layer components` is not

Fixture: one used `@utility ui-badge`, one unused `@utility ui-unused`, one used
`.legacy-badge` and one unused `.legacy-unused` in `@layer components`. Markup referenced
`ui-badge`, `hover:ui-badge`, `md:ui-badge`, `legacy-badge`, `hover:legacy-badge`.

| Declared as | Used in markup? | In `out.css`? |
| --- | --- | --- |
| `@utility ui-badge` | yes | yes |
| `@utility ui-unused` | no | **no** |
| `@layer components .legacy-badge` | yes | yes |
| `@layer components .legacy-unused` | no | **yes — emitted anyway** |

`grep -c ui-unused out.css` → `0`; `grep -c legacy-unused out.css` → `1`.

**Verdict: CONFIRMED on 4.3.3.** This is the tree-shaking half of the `@utility` case in
`references/affordances.md`.

## 2. Variants work on a `@utility` and cannot exist for a components class

From the same run:

```css
@layer utilities {
  :where(.ui-badge) { … }
  @media (hover: hover) {
    :where(.hover\:ui-badge:hover) { … }
  }
  @media (width >= 48rem) {
    :where(.md\:ui-badge) { … }
  }
}
@layer components {
  .legacy-badge { … }
}
```

`grep -c 'hover\\:legacy-badge' out.css` → `0`. The variant does not error; the class simply
never exists.

**Verdict: CONFIRMED on 4.3.3** — `hover:ui-badge` and `md:ui-badge` compile,
`hover:legacy-badge` does not.

## 3. `:where(&)` flattens to `:where(.name)`, and the descendant case is the sharp one

Source was `@utility ui-badge { :where(&) { … & > svg { @apply size-3 } … } }`. Output:

```css
:where(.ui-badge) {
  display: inline-flex;
  …
  & > svg {
    width: calc(var(--spacing) * 3);
    height: calc(var(--spacing) * 3);
  }
  &:hover {
    @media (hover: hover) { opacity: 90%; }
  }
}
```

- `:where(.ui-badge)` is **(0,0,0)** — a `ui-badge bg-red-500` class list lands the red.
- The nested `& > svg` resolves against that, so it is `:where(.ui-badge) > svg` at
  **(0,0,1)** and loses to a `size-4` placed on the svg itself. A bare `.ui-badge > svg`
  would be (0,1,1) and would silently win. This is the case `affordances.md` calls the
  strongest argument for `:where()`.

**Verdict: CONFIRMED on 4.3.3.**

## 4. `@variant hover { … }` is the block form of `hover:`

Visible in the dump above: it compiles to `&:hover { @media (hover: hover) { … } }` — the
same pair the `hover:` variant emits, `@media (hover: hover)` included. `affordances.md`
recommends the block form for readability and for Vue/Svelte/Astro `<style>` colon parsing;
it is not a different rule.

**Verdict: CONFIRMED on 4.3.3.**

## 5. Widths read the named container scale; heights do not

Fixture markup: `max-w-md max-w-2xl max-w-4xl max-w-5xl min-w-md max-h-md max-h-4xl min-h-md`.

```css
:root { --container-md: 28rem; --container-2xl: 42rem; --container-4xl: 56rem; --container-5xl: 64rem; }

.max-w-2xl { max-width: var(--container-2xl); }
.max-w-4xl { max-width: var(--container-4xl); }
.max-w-5xl { max-width: var(--container-5xl); }
.max-w-md  { max-width: var(--container-md); }
.min-w-md  { min-width: var(--container-md); }
```

`max-h-md`, `max-h-4xl` and `min-h-md` are **absent** — not emitted, not errored. So:

| Utility | Value | px |
| --- | --- | --- |
| `max-w-md` | `--container-md`, 28rem | 448 |
| `max-w-2xl` | 42rem | 672 |
| `max-w-4xl` | 56rem | **896** |
| `max-w-5xl` | 64rem | 1024 |

**Verdict: CONFIRMED on 4.3.3**, including the negative. `SKILL.md`'s rung 1b and its note
that the height axis is spacing-only both hold. 896 vs a `max-w-[900px]` is the 4px near-miss
the skill tells you to offer as a design call rather than rewrite.

## 6. A shadcn-derived radius scale is not the px numbers you remember

Fixture reproduces the shadcn scaffold: `--radius: 0.625rem` in `:root`, derivations in
`@theme inline`, `--radius-xs` deliberately not listed.

```css
--radius-xs: 0.125rem;                    /* default survives — not in the override block */
--radius-sm: calc(var(--radius) - 4px);

.rounded-sm { border-radius: calc(var(--radius) - 4px); }   /* 10px - 4px = 6px */
.rounded-md { border-radius: calc(var(--radius) - 2px); }
.rounded-lg { border-radius: var(--radius); }
.rounded-xs { border-radius: var(--radius-xs); }            /* 0.125rem = 2px */
```

**Verdict: CONFIRMED on 4.3.3.** Two things the skill leans on:

- `rounded-sm` is **6px** in a shadcn project, not the 4px an agent has memorised. Measured, but
  **not carried into the skill** — a precondition section covering it was written and then cut as
  bloat on review (2026-08-26). Kept here as evidence for the `rounded-xs` mapping below.
- `borderRadius: "2px"` in an inline style maps to **`rounded-xs`**, not `rounded-[2px]` —
  the correction in `cleanup.md`'s *Colour literals outside class strings* section, which the
  first draft got wrong by reaching for a bracket.

A project can override some rungs and leave others at their default in the same block. Grep
the entry point, compile one utility, read the value.

## 7. A custom `--spacing` makes the px→scale rewrite a resize

Fixture: `@theme { --spacing: 0.2rem; }`, markup `p-4 p-5 p-[16px]`.

```css
:root { --spacing: 0.2rem; }
.p-4        { padding: calc(var(--spacing) * 4); }   /* 0.8rem  = 12.8px */
.p-5        { padding: calc(var(--spacing) * 5); }   /* 1rem    = 16px   */
.p-\[16px\] { padding: 16px; }
```

**Verdict: CONFIRMED on 4.3.3.** `p-[16px]` is `p-5` here, not `p-4`. An `eslint --fix` that
assumes the default rewrites it to `p-4` and shrinks the padding by 20% with a clean exit
code — the worked example in `gotchas.md`'s *Never override `--spacing`*.

## 8. Open-ended scales make a bracket pointless

All generated on a default theme:

| Class | Emitted |
| --- | --- |
| `z-6` | `z-index: 6` |
| `z-9998` | `z-index: 9998` |
| `grid-cols-7` | `grid-template-columns: repeat(7, minmax(0, 1fr))` |
| `order-3` | `order: 3` |
| `min-w-13` | `min-width: calc(var(--spacing) * 13)` |
| `p-18` | `padding: calc(var(--spacing) * 18)` |
| `mt-21` | `margin-top: calc(var(--spacing) * 21)` |
| `w-101` | `width: calc(var(--spacing) * 101)` |

`min-w-[3.25rem]` emits `min-width: 3.25rem` — byte-equivalent to `min-w-13` at the default
`--spacing`, which is why `cleanup.md` tells you to match the **bracket** and convert whatever
unit is inside rather than grepping for `px`.

**Verdict: CONFIRMED on 4.3.3** for both the unbounded spacing scale and the open-ended
integer scales.

## 9. Bonus — the spacing formula soft row is now closed

[CLAIMS.md](CLAIMS.md)'s *Still soft* list carried this: `02` #8 reported that from 4.3.1,
`*-0` and `*-1` no longer emit the universal `calc(var(--spacing) * N)`. Re-run on 4.3.3 in an
isolated directory (`source(none)` + explicit `@source`):

```css
.p-0 { padding: 0px; }
.p-1 { padding: var(--spacing); }
.p-2 { padding: calc(var(--spacing) * 2); }
.p-4 { padding: calc(var(--spacing) * 4); }
```

**Verdict: `02` #8 CONFIRMED on 4.3.3.** 0 and 1 are special-cased. The skill's claim that
matters — every integer works and scales with `--spacing` — is unaffected; only the literal
`calc(…)` formula is imprecise at N=0 and N=1, and no rule depends on the exact emission.
Soft row closed as *confirmed-and-harmless* rather than left open.

---

## What was deliberately **not** re-run here

The four lint findings in the same revision (`no-conflicting-classes` /
`no-concatenated-classes` / `no-restricted-classes` firing; the `restrict` double-backslash
escaping bug; `no-deprecated-classes` being a duplicate subset; the whole-project
under-reporting) are properties of **`eslint-plugin-better-tailwindcss` 4.7.0 on ESLint
10.9.1**, not of Tailwind. Their versions are recorded inline in `references/editor.md`, which
is where a reader checking them would look. Re-running them under a different Tailwind would
not test anything.

The `scripts/oklch.mjs` transform is verified against the published reference value
(`#3b82f6` → `oklch(0.623 0.188 259.815)`) and round-trips back to `#3b82f6` via `--hex`.
It has no Tailwind dependency at all.
