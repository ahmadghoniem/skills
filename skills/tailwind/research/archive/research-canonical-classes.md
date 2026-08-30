> **Archive pointer.** Evidence for the canonical table and ESLint options. Pair with [research-upgrade-codemods.md](research-upgrade-codemods.md) (why not the upgrade CLI) and [research-cli-enforcement.md](research-cli-enforcement.md) (why no bundled scripts). Index: [README.md](README.md).

# Canonical Tailwind v4 class syntax (authoring-time)

**Goal:** teach an agent to *emit* canonical classes, not write verbose/`[&…]` forms and hope a linter rewrites them.

Sources: `github.com/tailwindlabs/tailwindcss` **`main`** SHA `90f8ff41c8e2…` (2026-08-14). Package on that tree: `packages/tailwindcss` = **4.3.3**.

- Engine: [`packages/tailwindcss/src/canonicalize-candidates.ts`](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/canonicalize-candidates.ts)
- Catalogue: [`packages/tailwindcss/src/canonicalize-candidates.test.ts`](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/canonicalize-candidates.test.ts)
- IntelliSense re-export: [`packages/tailwindcss/src/intellisense.ts`](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/intellisense.ts) (only re-exports `canonicalizeCandidates` + `CanonicalizeOptions`)
- IntelliSense *call site*: [`tailwindcss-intellisense` `packages/tailwindcss-language-service/src/diagnostics/canonical-classes.ts`](https://github.com/tailwindlabs/tailwindcss-intellisense/blob/main/packages/tailwindcss-language-service/src/diagnostics/canonical-classes.ts)
- Upgrade template codemods: [`packages/@tailwindcss-upgrade/src/codemods/template/`](https://github.com/tailwindlabs/tailwindcss/tree/main/packages/%40tailwindcss-upgrade/src/codemods/template)
- ESLint: [`eslint-plugin-better-tailwindcss` `docs/rules/enforce-canonical-classes.md`](https://github.com/schoero/eslint-plugin-better-tailwindcss/blob/main/docs/rules/enforce-canonical-classes.md)
- Docs: [Hover, focus, and other states](https://tailwindcss.com/docs/hover-focus-and-other-states)

Legend: **VERIFIED** = pair/behaviour read in source or tests. **INFERRED** = follows from that code without a dedicated pair.

Default *test* options (core file): `{ rem: 16, collapse: true, logicalToPhysical: true }`. Callers differ — see B/C/D.

`CanonicalizeOptions`:

```ts
{ rem?: number; collapse?: boolean; logicalToPhysical?: boolean }
```

---

## A) Variant canonicalisation

Pipeline (`VARIANT_CANONICALIZATIONS`): `themeToVarVariant` → `arbitraryValueToBareValueVariant` → `modernizeArbitraryValuesVariant` → `arbitraryVariants` (signature lookup against named variants). **VERIFIED.**

Engine comment: a single variant can explode into two, e.g. `[&>[data-selected]]:flex` → `*:data-selected:flex`.

### A.1 Child / descendant (`*` / `**`)

Docs: [`*:` → `:is(& > *)`](https://tailwindcss.com/docs/hover-focus-and-other-states), [`**:` → `:is(& *)`](https://tailwindcss.com/docs/hover-focus-and-other-states). Core only rewrites these at **top-level** (`parent === null`); `has-[&>*]` is **not** rewritten.

| BEFORE | AFTER | Notes |
| --- | --- | --- |
| `[&>*]:flex` / `[&_>_*]:flex` | `*:flex` | **VERIFIED** |
| `[&_*]:flex` | `**:flex` | **VERIFIED** |
| `[&>[data-visible]]:flex` | `*:data-visible:flex` | first-class `data-*` |
| `[&_[data-visible]]:flex` | `**:data-visible:flex` | |
| `[&_>_[foo]]:flex` | `*:[[foo]]:flex` | generic attribute — extra `[]` |
| `[&_[foo]]:flex` | `**:[[foo]]:flex` | |
| `[&_>_[foo=bar]]:flex` | `*:[[foo=bar]]:flex` | |
| `[&_[foo=bar]]:flex` | `**:[[foo=bar]]:flex` | |
| `[&_>_:first-child]:flex` | `*:first:flex` | |
| `[&_:first-child]:flex` | `**:first:flex` | |
| `[&_>_:--custom]:flex` | `*:[:--custom]:flex` | custom pseudo; extra `[]` around `:…` |
| `has-[&>[data-visible]]:flex` | **unchanged** | nested child combinator not modernised |

#### Why `*:[[role=checkbox]]` (nested brackets)

`*:` is only the combinator (`& > *`). The attribute is a **second stacked variant**.

- Outer `[]` = Tailwind **arbitrary-variant delimiter**.
- Inner `[]` = CSS **attribute selector**.

So `*:[[role=checkbox]]:translate-y-0.5` means `& > [role=checkbox]`.

`*:[role=checkbox]:…` would parse the inner part as selector `role=checkbox` (a type selector), **not** `[role=checkbox]`. That is why the extra pair is required.

`data-*` / `aria-*` have named variants, so the inner attribute is *not* wrapped:

| BEFORE | AFTER |
| --- | --- |
| `[&>[data-visible]]:flex` | `*:data-visible:flex` |
| `[&>[role=checkbox]]:flex` | `*:[[role=checkbox]]:flex` |
| `[&:has([role=checkbox])]:flex` | `has-[[role=checkbox]]:flex` |

Same extra-`[]` rule for any attribute that is not `data-*` or `aria-*`. **VERIFIED** (`[&_>_[foo]]` → `*:[[foo]]`, `[&:has([role=checkbox])]` → `has-[[role=checkbox]]`).

### A.2 Pseudo-class arbitrary variants → named

`arbitraryVariants` replaces an arbitrary variant when a named variant produces the **same signature**. If several named variants match, it keeps the input if it is already one of them (`min-lg` and `lg` both stay). **VERIFIED.**

| BEFORE | AFTER |
| --- | --- |
| `[&:focus]:flex` | `focus:flex` |
| `[&:first-child]:flex` | `first:flex` |
| `[&:not(:first-child)]:flex` | `not-first:flex` |
| `[&:nth-child(2)]:flex` | `nth-2:flex` |
| `[&:not(:nth-child(2))]:flex` | `not-nth-2:flex` |
| `[&:nth-child(-n+3)]:flex` | `nth-[-n+3]:flex` |
| `[&:nth-child(odd)]:flex` | `odd:flex` |
| `[&:not(:nth-child(odd))]:flex` | `even:flex` (De Morgan) |
| `[&:nth-child(even)]:flex` | `even:flex` |
| `[&:not(:nth-child(even))]:flex` | `odd:flex` |
| `[&:nth-last-child(2)]:flex` | `nth-last-2:flex` |
| `[&:is([data-visible])]:flex` | `data-visible:flex` |
| `has-[&:focus]:flex` | `has-focus:flex` |
| `not-[&:focus]:flex` | `not-focus:flex` |
| `group-[&:focus]:flex` | `group-focus:flex` |
| `peer-[&:focus]:flex` | `peer-focus:flex` |
| `in-[&:focus]:flex` | `in-focus:flex` |

**Do not** rewrite `[&:hover]` → `hover:` under default Tailwind. Default `hover` is `@media (hover: hover) { &:hover }`, so signatures differ and the test **keeps** `[&:hover]:flex`. It *does* rewrite if the project overrides `@variant hover (&:hover);`. **VERIFIED.**

### A.3 `has-*` / `not-*` / `in-*`

| BEFORE | AFTER |
| --- | --- |
| `[&:has([role=checkbox])]:flex` | `has-[[role=checkbox]]:flex` |
| `[&:has([aria-visible="true"])]:flex` | `has-aria-visible:flex` |
| `[&:has([data-slot=description])]:flex` | `has-data-[slot=description]:flex` |
| `has-[[data-visible]]:flex` | `has-data-visible:flex` |
| `has-[[aria-visible="true"]]:flex` | `has-aria-visible:flex` |
| `has-[[aria-visible]]:flex` | `has-aria-[visible]:flex` (presence ≠ `="true"`) |
| `has-[&:not(:nth-child(even))]:flex` | `has-odd:flex` |
| `[p_&]:flex` | `in-[p]:flex` |
| `[.foo_&]:flex` | `in-[.foo]:flex` |
| `[[data-visible]_&]:flex` | `in-data-visible:flex` |
| `[figure>&]:my-0` | **unchanged** (`>` ancestor, not descendant ` `) |
| `[[data-foo][data-bar]_&]:flex` | **unchanged** (compound selector) |

`in-*` only when the selector **ends with ` &`** (descendant combinator + nest). **VERIFIED.**

### A.4 `group-[]` / `peer-[]` (empty arbitrary)

Not in the core canonicaliser (empty `[]` does not parse). Upgrade:

1. `migrate-handle-empty-arbitrary-values.ts` — make it parse (`group-[]` → `group-[&]`, `peer-[]` → `peer-[&]`).
2. `migrate-modernize-arbitrary-values.ts` — `group-[&]` → `in-[.group]`. **Peer is left as `peer-[&]`.**

| BEFORE | AFTER | File |
| --- | --- | --- |
| `group-[]:flex` | `in-[.group]:flex` | `migrate-modernize-arbitrary-values.test.ts` |
| `group-[]/name:flex` | `in-[.group\/name]:flex` | same |
| `peer-[]:flex` | `peer-[&]:flex` | same — **not** `in-[.peer]` |
| `peer-[]/name:flex` | `peer-[&]/name:flex` | same |
| `has-group-[]:flex` | `has-in-[.group]:flex` | same |

Author `in-[.group]:` / `peer-[&]:` (or, better, `group-hover:` / `peer-invalid:` when a named state exists). Empty `group-[]` is a v3 leftover. **VERIFIED.**

Documented one-off `group-[.is-published]` is already canonical (not empty). Do not rewrite to `in-*`. **VERIFIED** (docs).

### A.5 `@media` / breakpoints / container queries

| BEFORE | AFTER | Needs `rem`? |
| --- | --- | --- |
| `[@media(scripting:none)]:flex` | `noscript:flex` | no |
| `[@media(pointer:fine)]:flex` | `pointer-fine:flex` | no |
| `[@media_print]:flex` | `print:flex` | no |
| `[@media_not_print]:flex` | `not-print:flex` | no |
| `[@media_not_(pointer:_fine)]:flex` | `not-pointer-fine:flex` | no |
| `[@media_not_(prefers-color-scheme:dark)]:flex` | `not-dark:flex` | no |
| `[@media_not_(prefers-color-scheme:unknown)]:flex` | `not-[@media_(prefers-color-scheme:unknown)]:flex` | no (hoist `not-` only) |
| `[@media(width>=theme(screens.lg))]:flex` | `lg:flex` | no |
| `[@media(width<theme(screens.lg))]:flex` | `max-lg:flex` | no |
| `min-[64rem]:flex` | `lg:flex` | no (same unit as `--breakpoint-lg`) |
| `max-[64rem]:flex` | `max-lg:flex` | no |
| `min-[1024px]:flex` | `lg:flex` | **yes** `{ rem: 16 }` |
| `min-[1024px]:flex` | **unchanged** | without `rem` |
| `@min-[28rem]:flex` | `@md:flex` | no |
| `@min-[448px]:flex` | `@md:flex` | **yes** `rem` |
| `min-lg:flex` | **unchanged** | already a valid named form |
| `min-[123px]:flex` | **unchanged** | no matching breakpoint |

Whitespace in `@media(…)` is canonicalised away. **VERIFIED.**

### A.6 `data-*` / `aria-*` / `supports-*` (not `[&…]`, but agents still emit these)

| BEFORE | AFTER |
| --- | --- |
| `data-[selected]:flex` | `data-selected:flex` |
| `data-[foo=bar]:flex` | **unchanged** (has `=`) |
| `[[data-url*="example"]]:flex` | `data-[url*="example"]:flex` |
| `aria-[selected="true"]:flex` | `aria-selected:flex` |
| `aria-[selected]:flex` | **unchanged** (presence, not `="true"`) |
| `aria-[selected*="true"]:flex` | **unchanged** (operator) |
| `supports-[gap]:flex` | `supports-gap:flex` |
| `supports-[display:grid]:flex` | **unchanged** |

**VERIFIED.**

### A.7 Other “do not touch” variant forms (from the same tests)

| Keep | Why |
| --- | --- |
| `[[data-visible][data-dark]]:flex` | multiple attribute selectors |
| `[:where([data-visible])]:flex` | `:where()` |
| `[&:has(~_*_*:checked)]:flex` | significant whitespace / complex `:has` |
| `has-[&>[data-visible]]:flex` | child combinator *inside* `has-` |
| custom `@variant is-macos (&.macos)` makes `[&.macos]` → `is-macos` | only if that variant exists |

---

## B) `collapse`

Official: `canonicalizeCandidates(list, { collapse: true })`. Groups by **same variant stack + same `!`**, then replaces a set with a shorter utility of **equal signature**. **VERIFIED** (`collapseCandidates`).

IntelliSense **does not collapse**. It calls `canonicalizeCandidates([oneClass], { rem: rootFontSize })` — one class at a time, no `collapse`, no `logicalToPhysical`. Comment in that file: list-level collapse is a *planned* enhancement. **VERIFIED.**

ESLint `enforce-canonical-classes`: `collapse` **default `true`**. Maps through as `canonicalizeCandidates(classes, { collapse, logicalToPhysical: logical, rem: rootFontSize })`. **VERIFIED** (`src/rules/enforce-canonical-classes.ts`).

### Official collapse (core tests)

| BEFORE | AFTER |
| --- | --- |
| `mt-1 mr-1 mb-1 ml-1` | `m-1` |
| `mt-1 mb-1` | `my-1` |
| `mb-1 mt-1` | `my-1` (order-independent) |
| `w-4 h-4` | `size-4` |
| `w-123 h-123` | `size-123` |
| `px-[1.2rem] py-[1.2rem]` | `p-[1.2rem]` |
| `px-[30.75rem] py-[30.75rem]` | `p-123` (with `rem: 16`) |
| `scroll-mt-1 scroll-mr-1 scroll-mb-1 scroll-ml-1` | `scroll-m-1` |
| `scroll-pt-1 scroll-pr-1 scroll-pb-1 scroll-pl-1` | `scroll-p-1` |
| `scroll-mt-1 scroll-mb-1` | `scroll-my-1` |
| `scroll-pt-1 scroll-pb-1` | `scroll-py-1` |
| `border-t-123 border-r-123 border-b-123 border-l-123` | `border-123` |
| `border-t-1 border-r-1 border-b-1 border-l-1` | `border` (`border` shorter than `border-1`) |
| `border-t-1 border-b-1` | `border-y` |
| `overflow-x-hidden overflow-y-hidden` | `overflow-hidden` |
| `overscroll-x-contain overscroll-y-contain` | `overscroll-contain` |
| `w-8 w-8` | `w-8` |
| `hover:w-4 h-4` | **unchanged** (different variants) |
| `[width:_16px_] [height:16px]` | `size-4` (needs `rem: 16`) |
| `[font-size:14px] [line-height:1.625]` | `text-sm/relaxed` |
| `text-sm` + `leading-7` (any combo of those families) | `text-sm/7` |

**INFERRED** (same algorithm, no dedicated core pair; ESLint test has it): `top-0 right-0 bottom-0 left-0` → `inset-0`. `pt-*`+`pr-*`+`pb-*`+`pl-*` → `p-*`; `pt-*`+`pb-*` → `py-*`; `pl-*`+`pr-*` → `px-*`.

**Not** in the official canonicaliser:

- Third-party `better-tailwindcss/enforce-shorthand-classes` is a *separate* rule with overlapping examples (`pt-4 pr-4 pb-4 pl-4` → `p-4`, `w-4 h-4` → `size-4`). Docs say disable it when `enforce-canonical-classes` + `collapse: true` is on.
- No core test that `ms-*`+`me-*` collapse to `mx-*`. `expandDeclaration` expands `margin-inline` → left+right, **not** `margin-inline-start`/`end`. **INFERRED:** `ml+mr` → `mx` (with `logicalToPhysical`); `ms+me` do **not**.

House style: if the skill wants IntelliSense-parity, **do not** require collapse (`w-4 h-4` may stay). If it wants ESLint default, prefer `size-*` / `p-*` / `m-*` / `inset-*`.

---

## C) `logicalToPhysical`

**Direction:** when computing signatures for collapse, expand **logical CSS properties to physical** so they can match physical longhands. **VERIFIED** (`expand-declaration.ts`, gated on `SignatureFeatures.LogicalToPhysical`).

| Logical property | Expands to |
| --- | --- |
| `margin-inline` | `margin-left` + `margin-right` |
| `margin-block` | `margin-top` + `margin-bottom` |
| `padding-inline` / `padding-block` | left+right / top+bottom |
| `inset-inline` / `inset-block` | left+right / top+bottom |
| `scroll-margin-*` / `scroll-padding-*` | same pattern |
| `border-inline*` / `border-block*` | left+right / top+bottom |

Effect on class lists (core JSDoc + ESLint test):

| BEFORE | AFTER | Flag |
| --- | --- | --- |
| `mr-2 ml-2` | `mx-2` | `logicalToPhysical: true` |
| `mr-2 ml-2` | **stay** (INFERRED) | `false` — `mx` is `margin-inline`, signatures would not match |

`mx-*` in v4 **is** logical (`margin-inline`). ESLint docs say “GOOD: using logical properties … `mx-2`” while naming the option `logicalToPhysical` — the *collapse target* is the logical shorthand; the *signature trick* is expand-logical-to-physical. **VERIFIED** mapping: ESLint `logical` → `{ logicalToPhysical: logical }`.

**Defaults**

| Caller | Default |
| --- | --- |
| `canonicalizeCandidates()` no opts | flag off (`options?.logicalToPhysical`) |
| Core test harness | `true` |
| IntelliSense | not passed (no collapse) |
| ESLint `logical` | **`true`** |

**Single classes are never rewritten** `ms-4` ↔ `ml-4`. Both are valid. Canonicaliser only uses this flag while collapsing pairs.

**For an LTR-only app:** leaving ESLint `logical: true` is still right: `ml-2 mr-2` → `mx-2` is the shorter, RTL-safe form. Do **not** teach “always write `ml`/`mr`”. Do **not** teach “rewrite `ms-4` to `ml-4`”. Prefer `mx-*`/`my-*`/`ms-*`/`me-*` when that is the intent; use `ml-*`/`mr-*` only when left/right must not flip in RTL.

---

## D) `rem` / `rootFontSize`

`rem` is the root font-size in **px**. Used to fold `px` ↔ `rem` before matching `--spacing` (default `0.25rem`). **VERIFIED** (`createSpacingCache`: `if (myUnit !== unit) return null` after `constantFoldDeclaration(input, rem)`).

Dedicated test:

```
canonicalizeCandidates(['m-[16px]'])                → ['m-[16px]']   // no rem = NO-OP
canonicalizeCandidates(['m-[16px]'], { rem: 16 })   → ['m-4']
canonicalizeCandidates(['m-[16px]'], { rem: 64 })   → ['m-1']
```

**VERIFIED.** Same path for any spacing utility (`p`, `m`, `gap`, `translate-*`, `inset`, `size`, …).

`translate-y-[2px]` → `translate-y-0.5`: **INFERRED** (no exact pair in the test file). At `rem: 16` and `--spacing: 0.25rem`, 2px = 0.125rem = `0.5` spacing step. **NO-OP without `rem`.**

Also `rem`-gated:

| Transformation | Without `rem` | With `{ rem: 16 }` |
| --- | --- | --- |
| `m-[16px]` → `m-4` | no-op | yes |
| `min-[1024px]:flex` → `lg:flex` | no-op | yes |
| `@min-[448px]:flex` → `@md:flex` | no-op | yes |
| `[width:16px] [height:16px]` → `size-4` | needs rem *and* collapse | yes |

**Not** `rem`-gated (same unit, or not spacing):

| Transformation | Works without `rem` |
| --- | --- |
| `left-[96rem]` → `left-384` | yes (rem ÷ `--spacing`) |
| `pt-[calc(var(--spacing)*8)]` → `pt-8` | yes |
| `m-[0]` / `m-[0px]` / `m-[0rem]` → `m-0` | tested with default opts (includes rem); `m-[0]` is unitless anyway |
| `border-[2px]` → `border-2` | **INFERRED** (border scale is px; signature match, not spacing cache) |
| variant `[&>*]` → `*:` | yes |

Cap: bare spacing values whose px length > **1536** (`96rem`) stay arbitrary (`left-[99999px]` stays). **VERIFIED.**

| Caller | `rem` |
| --- | --- |
| IntelliSense | `settings.tailwindCSS.rootFontSize` (VS Code default 16) |
| ESLint `rootFontSize` | **default `undefined`** → px→scale is a no-op unless set |
| Upgrade CLI `canonicalizeCandidates([raw])` | no options → no px→scale |

---

## E) Non-variant canonical forms

### E.1 Important: `!flex` → `flex!`

v4 print form is **trailing** `!`. Upgrade `migrate-canonicalize-candidate.test.ts`: `!flex` → `flex!`, `flex!` stays. **VERIFIED.** Core tests only exercise trailing (`important` strategy appends `!`). `printCandidate` always emits trailing; `canonicalizeCandidates` will normalise a parsed leading bang. **INFERRED** for the core function itself.

### E.2 CSS-variable shorthand

| BEFORE | AFTER | Where |
| --- | --- | --- |
| `bg-[--my-color]` | `bg-(--my-color)` | upgrade `migrate-automatic-var-injection` **VERIFIED** |
| `mt-[var(--my-var)]` | `mt-(--my-var)` | core canonicaliser **VERIFIED** |
| `bg-(color:--my-value)` | `bg-(--my-value)` | drop redundant datatype **VERIFIED** |
| `bg-[_--my-color]` | `bg-[--my-color]` | opt-out of auto-var (leading `_`) — upgrade only |
| `supports-[--test]:flex` | `supports-(--test):flex` | upgrade |

Bare `--foo` inside `[…]` is the v3 “please inject `var()`” form. v4 authors should write `bg-(--foo)` from the start. Core canonicaliser tests do **not** include `bg-[--my-color]`; that pair is upgrade-only. After var injection, core *does* shorten `var(--x)` → `(--x)`.

### E.3 Underscore / whitespace

`printCandidate` / `printArbitraryValue` collapses CSS whitespace (`_` in class names = space).

| BEFORE | AFTER | Where |
| --- | --- | --- |
| `[display:_flex_]` | `flex` | core (property → utility) **VERIFIED** |
| `[display:_flex_]` | `[display:flex]` | upgrade print-only step, then core turns it into `flex` |
| `w-[calc(100%_-_2rem)]` | `w-[calc(100%-2rem)]` | upgrade **VERIFIED** |
| `[@media_(scripting:_none)]:flex` | `noscript:flex` | core **VERIFIED** |
| `[&:has(~_*_*:checked)]:flex` | **unchanged** | spaces are significant **VERIFIED** |

### E.4 Comma vs underscore in arbitrary values

| BEFORE | AFTER | Where |
| --- | --- | --- |
| `grid-cols-[auto,1fr]` | `grid-cols-[auto_1fr]` | upgrade `migrate-legacy-arbitrary-values` only (`grid-cols`, `grid-rows`, `object`) **VERIFIED** |
| `object-[10px,20px]` | `object-[10px_20px]` | same |

**Not** in `canonicalize-candidates.test.ts`. Core will not save you. Agent must write `_`.

### E.5 v3→v4 renames — user’s list, checked

| User claim | Core `canonicalizeCandidates` | Upgrade (runs on v4) | Upgrade (v3-only `isMajor(3)`) | Agent should emit |
| --- | --- | --- | --- | --- |
| `flex-grow` → `grow` | **no** (not in `DEPRECATION_MAP`) | `migrate-simple-legacy-classes` **yes** (`flex-grow-0` → `grow-0`, shrink too) | — | `grow` / `shrink` |
| `overflow-ellipsis` → `text-ellipsis` | **yes** `DEPRECATION_MAP` | same migrator | — | `text-ellipsis` |
| `bg-gradient-to-r` → `bg-linear-to-r` | **yes** `bgGradientToLinear` (all 8 directions) | via final canonicalize pass | — | `bg-linear-to-*` |
| `break-words` → `wrap-break-word` | **yes** `DEPRECATION_MAP` | — | — | `wrap-break-word` |
| `bg-left-top` → `bg-top-left` | **no** | simple-legacy **yes** (“Since v4.1.0”), also `object-left-top` etc. | — | `bg-top-left` (and `object-top-left`) |
| `max-w-screen-md` | **no** | `migrate-max-width-screen` → `max-w-[theme(screens.md)]` (later `max-w-(--breakpoint-md)` via canonicalize) **VERIFIED** | — | `max-w-(--breakpoint-md)` or `max-w-md` if using container tokens |
| `shadow` → `shadow-sm` | **no** | — | **yes** `migrate-legacy-classes` | On v4: `shadow` already means the new default. **Do not remap.** |
| `rounded` → `rounded-sm` | **no** | — | **yes** (and `rounded-sm` → `rounded-xs` — v4→v4 would double-shift) | **Do not remap** on v4. |
| `outline-none` → `outline-hidden` | **no** | simple-legacy **only if v3** | — | **Do not remap.** v4 `outline-none` exists and means something else. |
| `ring` → `ring-3` | **no** | — | **yes** | **Do not remap** on v4. |
| `decoration-clone` | **no** | simple-legacy → `box-decoration-clone` **yes** | — | `box-decoration-clone` |

Extra core deprecations the user did not list (still emit the new name):

| BEFORE | AFTER |
| --- | --- |
| `order-none` | `order-0` |
| `start-*` / `-start-*` | `inset-s-*` / `-inset-s-*` (position inset, **not** margin `ms-*`) |
| `end-*` | `inset-e-*` |

If a project `@utility overflow-ellipsis { … }` reimplements the old name, canonicaliser **keeps** it. **VERIFIED.**

### E.6 Other high-frequency core pairs (not variant)

| BEFORE | AFTER |
| --- | --- |
| `[display:_flex_]` / `[display:flex]` | `flex` |
| `[color:red]` | `text-[red]` |
| `[color:var(--color-red-500)]` | `text-red-500` |
| `[text-wrap:balance]` | `text-balance` |
| `bg-[#fff]` / `bg-[#FFF]` | `bg-white` |
| `aspect-[12/34]` | `aspect-12/34` |
| `grid-cols-[subgrid]` | `grid-cols-subgrid` |
| `bg-red-500/[25%]` | `bg-red-500/25` |
| `bg-red-500/100` | `bg-red-500` |
| `tracking-[-0.05em]` | `tracking-tighter` |
| `-tracking-tight` | `tracking-wide` (negating the named scale) |
| `leading-[123]` | **unchanged** (`leading-123` would be `--spacing(123)`) |
| `w-[calc(100%/3.5)]` | **unchanged** (do not fold to a repeating decimal %) |

---

## F) Skill rules (~10, ranked)

Rank = (how often an LLM emits it from v3/training data) × (how wrong/verbose it looks). Imperative one-liners:

1. **Never write `[&>*]:` or `[&_*]:` — use `*:` (direct children) and `**:` (all descendants).** Stack further variants after that: `*:first:`, `**:data-open:`.
2. **Attribute-on-child: `*:[[role=checkbox]]:`, never `[&>[role=checkbox]]:`. Extra `[]` because outer = arbitrary variant, inner = CSS attribute.** Exception: `data-*`/`aria-*` → `*:data-selected:` / `*:aria-checked:`.
3. **Write `has-[[role=x]]:`, `not-first:`, `nth-2:`, `odd:` — not `[&:has(…)]:`, `[&:not(:first-child)]:`, `[&:nth-child(2)]:`, `[&:nth-child(odd)]:`.**
4. **Do not rewrite `[&:hover]:` to `hover:`.** Default `hover` also wraps `@media (hover: hover)`. Use `hover:` when you *mean* the named variant; keep `[&:hover]:` only if you truly want hover-without-the-media-query (rare).
5. **Important is trailing: `flex!`, never `!flex`.**
6. **CSS variables: `bg-(--token)`, never `bg-[--token]` or `bg-[var(--token)]`.** Same for modifiers: `bg-red-500/(--alpha)`.
7. **v4 names: `bg-linear-to-r`, `grow`/`shrink`, `text-ellipsis`, `wrap-break-word`, `box-decoration-clone`, `bg-top-left`.** Never `bg-gradient-to-*`, `flex-grow`, `overflow-ellipsis`, `break-words`, `decoration-clone`, `bg-left-top`.
8. **On already-v4 code, do not apply v3 scale migrations:** `shadow`≠`shadow-sm`, `rounded`≠`rounded-sm`, `outline-none`≠`outline-hidden`, `ring`≠`ring-3`.
9. **Named variants over arbitrary: `data-open:`, `aria-selected:`, `print:`, `lg:` / `max-lg:`, `focus:` — not `data-[open]:`, `aria-[selected="true"]:`, `[@media_print]:`, `[@media(width>=theme(screens.lg))]:`, `[&:focus]:`.** Keep `data-[foo=bar]:` and `aria-[selected]:` (presence) as-is.
10. **Empty group/peer: `in-[.group]:` and `peer-[&]:`, never `group-[]:` / `peer-[]:`.** Prefer `group-hover:` / `peer-invalid:` when a named state exists. Do not invent `in-[.peer]:`.
11. **Arbitrary values: underscores not commas (`grid-cols-[auto_1fr]`), no padding underscores (`[display:flex]` not `[display:_flex_]`), prefer a scale step (`p-4` not `p-[16px]`, `translate-y-0.5` not `translate-y-[2px]`) assuming 16px root.**
12. **Shorthands if the house style matches ESLint `collapse: true`:** `size-4` not `w-4 h-4`; `p-4` not `px-4 py-4`; `m-4` not `mt-4 mr-4 mb-4 ml-4`; `mx-4` not `ml-4 mr-4`. Skip this rule if targeting IntelliSense-only (it will not suggest list collapses).

---

## G) When the arbitrary form is correct (do not over-correct)

| Keep arbitrary / verbose form | Why |
| --- | --- |
| `[&:hover]:` | Default `hover:` adds `@media (hover: hover)` — **different CSS**. **VERIFIED.** |
| `min-lg:` (vs `lg:`) | Both valid; engine keeps whichever you wrote. **VERIFIED.** |
| `has-[&>[data-x]]:` | Child combinator inside `has-` is not modernised. **VERIFIED.** |
| `[figure>&]:` | `in-*` is descendant (`… &`), not child (`figure > &`). **VERIFIED.** |
| `[[data-foo][data-bar]_&]:` / `[[data-a][data-b]]:` | Multi-selector / multi-attribute. **VERIFIED.** |
| `[:where([data-x])]:` | `:where()` specificity. **VERIFIED.** |
| `[&:has(~_*_*:checked)]:` | Significant combinator whitespace. **VERIFIED.** |
| `data-[foo=bar]:` / `aria-[selected]:` / `aria-[selected*="true"]:` | `=` / presence / operators are not the named `data-foo` / `aria-selected`. **VERIFIED.** |
| `leading-[123]` | `leading-123` is spacing-scale, not raw `123`. **VERIFIED.** |
| `left-[99999px]` | Beyond 1536px bare-value cap. **VERIFIED.** |
| `group-[.is-published]:` | Documented arbitrary group; not empty `group-[]`. **VERIFIED** (docs). |
| `outline-none` on v4 | Not `outline-hidden`. **VERIFIED** (upgrade gated to v3). |
| `shadow` / `rounded` / `ring` on v4 | Already the post-migration names. Remapping again is wrong. **VERIFIED.** |
| A `@utility` that redefines `break-words` etc. | Signature no longer matches; keep. **VERIFIED.** |
| `text-foreground/60` vs `text-default-soft-hover` when theme vars are CSS-wide keywords (`unset`) | Do not merge. **VERIFIED.** |
| Any selector with no named equivalent | Arbitrary variants are the escape hatch. If `arbitraryVariants` finds no signature match, it stays. |

Specificity note: named `*:` compiles to `:is(& > *)`; raw `[&>*]:` is `& > *`. The engine treats signatures as equal and **does** rewrite. Do not “correct” back to `[&>*]` for specificity — v4 designed `*:` to be the replacement ([PR #15022](https://github.com/tailwindlabs/tailwindcss/pull/15022)). **VERIFIED** (tests + PR). Over-correcting *to* `hover:` from `[&:hover]:` is the dangerous one.

---

## Caller cheat-sheet

| | `rem` | `collapse` | `logicalToPhysical` |
| --- | --- | --- | --- |
| Core default (no opts) | off | off | off |
| Core unit tests | 16 | true | true |
| IntelliSense `suggestCanonicalClasses` | `rootFontSize` | **off** (1 class) | off |
| ESLint `enforce-canonical-classes` | `rootFontSize` default **undefined** | default **true** | `logical` default **true** |
| `@tailwindcss/upgrade` final pass | off | off | off |

Closest match to VS Code hints: ESLint `{ rootFontSize: 16, collapse: false, logical: false }`. Closest match to “fully canonical lists”: `{ rootFontSize: 16, collapse: true, logical: true }` (plugin defaults except `rootFontSize`).
