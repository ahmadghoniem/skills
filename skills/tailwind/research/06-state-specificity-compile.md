# 06 — State-variant specificity, compiled

Fills the evidence gap `CLAIMS.md` flags for the `data-active:hover:` rule in `tailwind/SKILL.md`
and `tailwind/references/cleanup.md`. The skill says "Compiled on 4.3.3" — this is that compile.
It was run in the Claude Code session, not by the round-2 agent, which is why it is absent from
`05-build-verification.md`.

**Supersedes** the mechanism given in `04-ui-collisions-salvage.md` (C7), which claimed stock
`hover:` and `data-active:` tie at (0,2,0) with order deciding. That is right for stock and wrong
about the outcome — see below.

## Setup

`tailwindcss@4.3.3` + `@tailwindcss/cli@4.3.3` in `%TEMP%\c7test`, two isolated subdirectories
sharing one source file so only the variant definition differs.

```html
<a class="hover:bg-red-500/50 data-active:bg-red-500 data-active:hover:bg-red-500"></a>
```

```css
@import "tailwindcss" source(none);
@source "./index.html";
```

The `shadcn/` case additionally defines the variant exactly as `shadcn@4.18.0/dist/tailwind.css`
ships it (see the appendix of `05-build-verification.md`):

```css
@custom-variant data-active {
  &:where([data-state="active"]),
  &:where([data-active]:not([data-active="false"])) {
    @slot;
  }
}
```

## Result A — stock Tailwind (no custom variant)

```css
@layer utilities {
  @media (hover: hover) {
    .hover\:bg-red-500\/50:hover { … }
  }
  .data-active\:bg-red-500[data-active] { … }
  @media (hover: hover) {
    .data-active\:hover\:bg-red-500[data-active]:hover { … }
  }
}
```

| Rule | Selector | Specificity |
| --- | --- | --- |
| `hover:` | `.hover\:…:hover` | (0,2,0) |
| `data-active:` | `.data-active\:…[data-active]` | (0,2,0) |
| compound | `.data-active\:hover\:…[data-active]:hover` | (0,3,0) |

Tie between the first two, and `data-active:` is emitted **second** — so **the active state wins
and there is no bug**. The compound is not needed under stock variants.

## Result B — shadcn's `:where()`-wrapped variant

```css
@layer utilities {
  @media (hover: hover) {
    .hover\:bg-red-500\/50:hover { … }
  }
  .data-active\:bg-red-500:where([data-state="active"]),
  .data-active\:bg-red-500:where([data-active]:not([data-active="false"])) { … }
  @media (hover: hover) {
    :is(.data-active\:hover\:bg-red-500:where([data-state="active"]),
        .data-active\:hover\:bg-red-500:where([data-active]:not([data-active="false"]))):hover { … }
  }
}
```

`:where()` contributes **zero** specificity, so the attribute match is free:

| Rule | Effective specificity |
| --- | --- |
| `hover:` | (0,2,0) |
| `data-active:` | **(0,1,0)** — class only |
| compound | **(0,2,0)** — `:is()` takes its most specific argument, itself (0,1,0), plus `:hover` |

`hover:` outranks `data-active:` on specificity, so it wins **regardless of emission order**.
This is the failure the UI-collisions log recorded. The compound ties `hover:` at (0,2,0) and
wins on being emitted last — not, as the skill first said, by outranking it at (0,3,0).

## Verdict

**CONFIRMED with a corrected mechanism.** The demotion is a `:where()` artefact of the component
library's variant definition, not Tailwind behaviour. shadcn wraps its variants in `:where()`
deliberately so they stay easy to override; the side effect is that a state variant cannot beat a
plain `hover:`. The same applies to every `:where()`-wrapped variant in that file — `data-open`,
`data-closed`, `data-checked`, `data-selected`, `data-disabled`, `data-horizontal`,
`data-vertical`.

Wording now in the skill reflects this; `04`'s C7 section does not and should be read against
this file.
