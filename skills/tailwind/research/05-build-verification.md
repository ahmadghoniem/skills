> **Provenance:** **live**. Only local 4.3.3 compile log. The `shadcn@4.18.0` `dist/tailwind.css` it analysed now lives at [`archive/shadcn-4.18.0-tailwind.css`](archive/shadcn-4.18.0-tailwind.css) — keep it intact. Current skill wording: [CLAIMS.md](CLAIMS.md).

# Build verification — Tailwind CSS 4.3.3

Scratch dir: `%TEMP%\tw-verify` (`C:\Users\Ahmed Ibrahim\AppData\Local\Temp\tw-verify`). No `node_modules` in this workspace. Command used: `node node_modules/@tailwindcss/cli/dist/index.mjs -i in.css -o out.css` (same as `npx @tailwindcss/cli`). Each claim compiled in its own subdirectory so source scanning could not mix HTML files.

## Resolved versions

| Package | Requested | Resolved (`npm ls` / `package.json`) |
| --- | --- | --- |
| `tailwindcss` | `4.3.3` | **4.3.3** |
| `@tailwindcss/cli` | `4.3.3` | **4.3.3** |

Every successful compile banner: `≈ tailwindcss v4.3.3`. Emitted CSS banner: `/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */`.

---

## Claim 2 — `oklch()` comma form passes through untouched

Skill (`tailwind/SKILL.md`): *"`oklch()` has no legacy comma form. Tailwind does **not** validate this — `oklch(0.7 0.1 250, 0.5)` passes through the build untouched and no warning appears; the browser drops the declaration at parse time. A green build is not evidence the colour works."*

### (a–d) Value in `@theme`

Input CSS:

```css
@import "tailwindcss";
@theme { --color-bad: oklch(0.7 0.1 250, 0.5); }
```

Source: `<div class="bg-bad"></div>`

- (a) Build **succeeds**.
- (b) Exit code **0**.
- (c) Full stdout + stderr (stdout empty):

```
≈ tailwindcss v4.3.3

Done in 46ms
```

No warning. The word `warn` does not appear. The comma form is not mentioned.

- (d) Emitted token and utility, byte for byte:

```css
    --color-bad: oklch(0.7 0.1 250, 0.5);
```

```css
  .bg-bad {
    background-color: var(--color-bad);
  }
```

The invalid function is copied into the theme layer unchanged. The utility points at `var(--color-bad)` and does not rewrite the colour.

### (e) Same value in a plain `:root` block

Input CSS:

```css
@import "tailwindcss";
:root { --color-bad: oklch(0.7 0.1 250, 0.5); }
```

Source: `<div class="bg-bad"></div>`

Exit **0**. stdout empty. stderr:

```
≈ tailwindcss v4.3.3

Done in 29ms
```

Still no warning. Tail of `out.css`:

```css
@layer utilities;
:root {
  --color-bad: oklch(0.7 0.1 250, 0.5);
}
```

Differences vs `@theme`:

- The comma form still passes through untouched.
- `--color-bad` is **not** registered as a Tailwind colour token, so **no `.bg-bad` rule is emitted** (`out.css` has no `.bg-bad`).
- `@layer utilities` is emitted empty (`@layer utilities;`).

**CONFIRMED**

---

## Claim 11 — same-property winner is emission order

Skill (`tailwind/references/cleanup.md`): *"Verified in 4.3.3: `.w-32` is emitted *before* `.w-full`, so **`w-full` wins**; `.text-lg` before `.text-sm`, so **`text-sm` wins**. Spacing is the one that looks intuitive only because the scale sorts ascending — `p-4` beats `p-2` whichever order you write them in."*

Input CSS: `@import "tailwindcss";`

### Source A — `w-32 w-full text-sm text-lg p-2 p-4`

Exit **0**. stderr: `≈ tailwindcss v4.3.3` / `Done in 29ms`. Full `@layer utilities` from `out.css`:

```css
@layer utilities {
  .w-32 {
    width: calc(var(--spacing) * 32);
  }
  .w-full {
    width: 100%;
  }
  .p-2 {
    padding: calc(var(--spacing) * 2);
  }
  .p-4 {
    padding: calc(var(--spacing) * 4);
  }
  .text-lg {
    font-size: var(--text-lg);
    line-height: var(--tw-leading, var(--text-lg--line-height));
  }
  .text-sm {
    font-size: var(--text-sm);
    line-height: var(--tw-leading, var(--text-sm--line-height));
  }
}
```

| Pair | First in file | Cascade winner |
| --- | --- | --- |
| `.w-32` vs `.w-full` | `.w-32` | **`w-full`** |
| `.text-sm` vs `.text-lg` | `.text-lg` | **`text-sm`** |
| `.p-2` vs `.p-4` | `.p-2` | **`p-4`** |

### Source B — opposite markup (`w-full w-32 text-lg text-sm p-4 p-2`)

Exit **0**. `c11-a/out.css` and `c11-b/out.css` are **byte-identical** (5202 bytes). Markup order does not change emission order.

### Property sets for `text-sm` / `text-lg`

Both emit **two** declarations: `font-size` and `line-height`. The later class (`.text-sm`) therefore wins **both** properties. This is not a split per-property mismatch between the two classes; the skill’s “winner” wording is safe for this pair.

Theme vars those utilities use (same file, `@layer theme`):

```css
    --text-sm: 0.875rem;
    --text-sm--line-height: calc(1.25 / 0.875);
    --text-lg: 1.125rem;
    --text-lg--line-height: calc(1.75 / 1.125);
```

**CONFIRMED**

---

## Claim 23 — `--spacing(6)` in an unprocessed block

Skill (`tailwind/references/gotchas.md`): *"`--spacing(6)` will not work here. It is a Tailwind *build-time* function, not a CSS variable — in an unprocessed block it hard-errors (`The --spacing(…) function requires that the --spacing theme variable exists`)."*

### 1. Compiled file, no `@import "tailwindcss"`, no theme

Input:

```css
.box { padding: --spacing(6); }
```

Exit **1**. stdout empty. stderr **verbatim** (including ANSI):

```
≈ tailwindcss v4.3.3

[31mError:[39m
[2m┌[22m
[2m│[22m Error: The --spacing(…) function requires that the `--spacing` theme variable exists, but it was not found.
[2m└[22m
```

Stripped message:

```
Error: The --spacing(…) function requires that the `--spacing` theme variable exists, but it was not found.
```

No `out.css` was written.

The skill quote is **not** an exact match. Current text adds backticks around `--spacing` and the clause `, but it was not found.`

### 2. Same file with `@reference "tailwindcss"`

Input:

```css
@reference "tailwindcss";
.box { padding: --spacing(6); }
```

Exit **0**. stderr: `≈ tailwindcss v4.3.3` / `Done in 22ms`. Full `out.css`:

```css
/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */
.box {
  padding: calc(var(--spacing, 0.25rem) * 6);
}
```

`--spacing(6)` **does resolve** under `@reference`. No Preflight, no theme dump — only the referenced function expansion.

Corrected wording if the skill must quote the error: *in a file compiled without a `--spacing` theme variable it hard-errors (`The --spacing(…) function requires that the `--spacing` theme variable exists, but it was not found.`). With `@reference "tailwindcss"` it compiles to `calc(var(--spacing, 0.25rem) * 6)`.*

**CHANGED** (hard-error behaviour still true; quoted string is stale; `@reference` resolves)

---

## Claim 24 — the v3 `@tailwind` trio

Skill (`tailwind/references/gotchas.md`): *"This does **not** error in v4. Only `@tailwind utilities` is still honoured, so the build succeeds and emits utilities — with no Preflight and no theme variables, leaving every `bg-background`-style token dead. A build that "works" but renders unstyled is this."*

Input CSS (exact):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Source: `<div class="flex p-4 bg-red-500"></div>`

- (a) Exit code **0**.
- (b) stdout empty. stderr:

```
≈ tailwindcss v4.3.3

Done in 13ms
```

- (c) Full `out.css`:

```css
/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */
.flex {
  display: flex;
}
```

| Check | Present? |
| --- | --- |
| Preflight (`*, ::before, ::after` / `box-sizing`) | **No** |
| `:root` theme vars (`--color-red-500`, `--spacing`) | **No** |
| `.flex` | **Yes** |
| `.p-4` | **No** |
| `.bg-red-500` | **No** |

- (d) **Something else** — not a hard error, and not “silent success with utilities only” in the sense the brief’s source file would suggest.

`@tailwind base` / `components` emit nothing. `@tailwind utilities` runs **without loading the default theme**, so only utilities that do not need theme keys appear. `flex` is one of those. `p-4` and `bg-red-500` are omitted entirely, not emitted as broken `var(--…)` declarations. Semantic tokens such as `bg-background` would likewise never appear.

Skill sentence that is wrong: *"Only `@tailwind utilities` is still honoured, so the build succeeds and emits utilities — with no Preflight and no theme variables, leaving every `bg-background`-style token dead."*

Corrected: *The v3 trio does not error. Only `@tailwind utilities` is honoured, and it runs with no theme and no Preflight. Theme-independent utilities such as `flex` still emit; scale utilities (`p-4`, `bg-red-500`) and semantic tokens are not generated at all. Replace the trio with `@import "tailwindcss";`.*

**CHANGED**

---

## Bonus — what is `shadcn/tailwind.css`?

Sources (Exa + published tarball, not a compile): [theming](https://ui.shadcn.com/docs/theming), [May 2026 eject changelog](https://ui.shadcn.com/docs/changelog/2026-05-shadcn-eject), npm `shadcn@4.18.0` (`npm pack`, `exports["./tailwind.css"]` → `./dist/tailwind.css`), [unpkg](https://unpkg.com/shadcn@latest/dist/tailwind.css).

### Package and version

- npm package: **`shadcn`** (the CLI / shared CSS package), not a separate CSS package.
- Subpath export: `"./tailwind.css": "./dist/tailwind.css"` in `package.json`. Import specifier is `"shadcn/tailwind.css"`.
- Current published version retrieved: **4.18.0** (npm, 2026-08-13). `sideEffects` includes `./dist/tailwind.css`.
- I did **not** run `npx shadcn@latest init` (interactive / project-scaffolding). Official changelog states: *When you run `init`, it adds `@import "shadcn/tailwind.css"` to your global CSS file.* The current Default Theme CSS on the theming page starts with both `@import "tailwindcss";` and `@import "shadcn/tailwind.css";`.

### What is inside

Not a base-layer reset. Not `@custom-variant dark`. Not a drop-in replacement for `tw-animate-css` as a whole (changelog “Before” still has `@import "tw-animate-css";` **and** `@import "shadcn/tailwind.css";`).

It ships:

1. Accordion keyframes in `@theme inline` (`accordion-down` / `accordion-up`, Radix + Base UI height vars).
2. Shared `@custom-variant`s: `data-open`, `data-closed`, `data-checked`, `data-unchecked`, `data-selected`, `data-disabled`, `data-active`, `data-horizontal`, `data-vertical`.
3. `@utility no-scrollbar`.
4. Scroll-fade `@property` / `@utility` family.
5. Shimmer `@utility` family (uses `@variant dark` internally; that **consumes** dark mode, it does not define the `dark` variant).

### Required vs additive

Additive shared CSS for current component recipes (`data-open:`, `no-scrollbar`, accordion motion, etc.). Semantic theme tokens (`bg-background`, radius ladder) live in the project’s own `@theme inline` / `:root` / `.dark` and work without this file. Skipping the import breaks components that use those custom variants (documented user reports for Switch / Dialog / `data-horizontal:`).

### Does it replace hand-written `@custom-variant dark (&:is(.dark *))`?

**No.** `dist/tailwind.css` contains **zero** `@custom-variant dark`. The official default theme still writes that line **after** the import:

```css
@import "tailwindcss";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));
```

The skill scaffold’s manual dark variant is still required. It is not redundant with `shadcn/tailwind.css`. Duplicate `dark` variants would only happen if the project also defined the same `@custom-variant dark` twice in its own CSS.

Full published file (630 lines) is in the appendix.

---

## Summary

| Claim | Verdict |
| --- | --- |
| 2 comma `oklch()` | **CONFIRMED** |
| 11 emission order (`w-*`, `text-*`, `p-*`) | **CONFIRMED** |
| 23 `--spacing(6)` error / `@reference` | **CHANGED** |
| 24 `@tailwind` trio | **CHANGED** |
| Bonus `shadcn/tailwind.css` | additive `shadcn@4.18.0` export; does **not** define `dark` |

---

## Appendix — `shadcn@4.18.0` `dist/tailwind.css`

Extracted to [`archive/shadcn-4.18.0-tailwind.css`](archive/shadcn-4.18.0-tailwind.css) so it is greppable and
diffable as CSS instead of prose. Exact file from `npm pack shadcn@4.18.0`; matched unpkg `@latest` at
fetch time. It is the source for the `@custom-variant` definitions quoted above and for the `:where()`
wrapping compiled in [06-state-specificity-compile.md](06-state-specificity-compile.md).
