# 08 — Remaining unevidenced claims

Closes the six gaps `research/CLAIMS.md` still lists after `07-missing-token-compile.md` (`--radius-xl` / omitted `--popover` failure modes) and `06-state-specificity-compile.md` (`data-active:` specificity).

`tailwindcss@4.3.3` + `@tailwindcss/cli@4.3.3` from `%TEMP%\tw-verify` (`node -e "console.log(require('tailwindcss/package.json').version)"` → `4.3.3`). Compile command, from each test subdirectory of that install so `@import "tailwindcss"` resolves:

```text
node node_modules/@tailwindcss/cli/dist/index.mjs -i in.css -o out.css
```

Each `in.css` is `@import "tailwindcss" source(none);` plus `@source "./index.html";`. Isolated dirs *outside* `tw-verify` failed with `Can't resolve 'tailwindcss'` — tests therefore live at `%TEMP%\tw-verify\gap08-viewport`, `gap08-clamp`, `gap08-mobilefirst`. Theme + Preflight omitted below; `@layer utilities` is the whole utilities output.

Do not treat this file as a skill edit. Nothing under `tailwind/` was changed.

---

## 1. `h-screen` vs `h-dvh`

Skill (`gotchas.md`): *"`h-screen` ignores mobile browser chrome. Use `h-dvh` (dynamic viewport height) for full-height mobile layouts."*

Source: `<div class="h-screen h-dvh h-svh h-lvh"></div>`. Exit **0**.

```css
@layer utilities {
  .h-dvh {
    height: 100dvh;
  }
  .h-lvh {
    height: 100lvh;
  }
  .h-screen {
    height: 100vh;
  }
  .h-svh {
    height: 100svh;
  }
}
```

`h-screen` is `100vh`. `h-dvh` is `100dvh`. `h-svh` (`100svh`) and `h-lvh` (`100lvh`) both exist as utilities; the skill names neither.

The chrome-tracking half is not a Tailwind fact. MDN (`<length>` viewport-percentage units): viewport-percentage lengths are based on four viewport sizes — small, large, dynamic, and default — “in response to browser interfaces expanding and retracting dynamically”. MDN numeric data types: `vh` = 1% of the viewport’s height; `dvh` = 1% of the **dynamic** viewport’s height; `svh` / `lvh` = small / large. CSS Values and Units Level 4 (`#viewport-relative-lengths`) is the spec those units come from. Labelled **documented**, not compiled: this session did not run a mobile browser.

**CONFIRMED** — **compiled** (emitted units) + **documented** (chrome behaviour).

---

## 2. `line-clamp-*`

Skill (`gotchas.md`): *"`line-clamp-*` is a different mechanism — it clamps *lines*, requires the text to wrap, and never wants a width constraint or `whitespace-nowrap`."*

Source: `<div class="line-clamp-3 truncate whitespace-nowrap w-64"></div>`. Exit **0**.

```css
@layer utilities {
  .line-clamp-3 {
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }
  .w-64 {
    width: calc(var(--spacing) * 64);
  }
  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .whitespace-nowrap {
    white-space: nowrap;
  }
}
```

From those declarations:

- `line-clamp-3` does set `overflow: hidden`, `display: -webkit-box`, `-webkit-box-orient: vertical`, `-webkit-line-clamp: 3`. It does **not** set `white-space`.
- `truncate` does set `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`.

`whitespace-nowrap` (and `truncate`) defeat line-clamp because they force a single line: `-webkit-line-clamp` has nothing to wrap. A width constraint does **not** fight line-clamp — `w-64` only sets `width`. Line-clamp needs a finite inline size so wrapping can happen; “never wants a width constraint” is backwards.

Corrected (skill voice): *`line-clamp-*` clamps lines (`-webkit-line-clamp`) and needs wrapping — do not pair it with `truncate` or `whitespace-nowrap`. A width constraint is how the wrap width is set.*

**OVERSTATED** — **compiled**.

---

## 3. `next-themes` `attribute="class"`

Skill (`setup.md`): *"`attribute=\"class\"` toggles `.dark` on `<html>`, which is what `@custom-variant dark (&:is(.dark *))` keys off."*

Not compilable. Inspected published **`next-themes@0.4.6`** (`npm pack next-themes`; npm `dist-tags.latest` = `0.4.6`). Types + runtime from `package/dist/index.d.ts` and `package/dist/index.mjs`.

`attribute` is still the API. It is **not** defaulted to `"class"`:

```ts
/** HTML attribute modified based on the active theme. Accepts `class`, `data-*` … or an array */
attribute?: Attribute | Attribute[] | undefined;
type Attribute = DataAttribute | 'class';
```

Minified provider defaults (`index.mjs`): `attribute:h="data-theme"`. README: *“By default, next-themes modifies the `data-theme` attribute on the `html` element”* and *`attribute = 'data-theme'` … accepts `class` and `data-*`*. Tailwind section still shows `<ThemeProvider attribute="class">`. Not renamed.

When `attribute` is `"class"`, the resolved theme name is added as a class on `document.documentElement`. Apply path (same file; `P = document.documentElement`, `v` = mapped or raw resolved theme after `system` → `light`/`dark`):

```js
g==="class"?(P.classList.remove(...k),v&&P.classList.add(v)):g.startsWith("data-")&&(v?P.setAttribute(g,v):P.removeAttribute(g))
```

README: *“setting the theme to `"dark"` will set `class="dark"` on the `html` element.”* Default `themes = ['light', 'dark']`, so the class is literally `dark` unless `value` remaps it. That is what `&:is(.dark *)` matches. Without `attribute="class"`, the library writes `data-theme` instead and the skill’s variant does not fire.

**CONFIRMED** — **source-read** (`next-themes@0.4.6`). The prop is still required; the default is `data-theme`.

---

## 4. Mobile-first `sm:hidden md:block`

Skill (`gotchas.md`): *"Unprefixed applies everywhere; `md:` applies at md **and up**. `sm:hidden md:block` = hidden on small, shown md+ (not \"only md\")."*

Source: `<div class="sm:hidden md:block"></div>`. Exit **0**.

```css
@layer utilities {
  @media (width >= 40rem) {
    .sm\:hidden {
      display: none;
    }
  }
  @media (width >= 48rem) {
    .md\:block {
      display: block;
    }
  }
}
```

`sm` = `40rem`, `md` = `48rem`. Both are `min-width`-style (`width >= …`). `sm:hidden` is emitted first, then `md:block`.

| Viewport | Matching rules | `display` on a `<div>` |
| --- | --- | --- |
| 30rem (`< sm`) | none | visible (`block` from UA, neither utility) |
| 44rem (`sm`–`md`) | `.sm\:hidden` only | `none` |
| 50rem (`≥ md`) | both; later `md:block` wins the `display` tie | `block` |

“Hidden on small, shown md+” is loose: below `sm` the element is **visible**. “Not only md” is right for the `md:` half.

Corrected (skill voice): *Unprefixed applies everywhere; `md:` is md and up, not “only md”. `sm:hidden md:block` is visible below `sm`, hidden from `sm` until `md`, shown md+.*

**OVERSTATED** — **compiled**.

---

## 5. `--popover` consumers

Skill (`setup.md`): *"`--popover` / `--popover-foreground` are used by Popover, Dialog, DropdownMenu, Select, Command and Tooltip."*

Not compilable. Read current shadcn registry at `https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/*.tsx` (repo `main` HEAD `25be24cca34d06eed29a4779c3f48c4816aa812c`, 2026-08-20). Grep `bg-popover` / `text-popover-foreground`.

| Skill name | Uses popover tokens? | File:line (matched class string) |
| --- | --- | --- |
| Popover | **yes** | `popover.tsx:33` `… border bg-popover p-4 text-popover-foreground shadow-md …` |
| DropdownMenu | **yes** | `dropdown-menu.tsx:45` (content) and `:233` (subcontent) `bg-popover` / `text-popover-foreground` |
| Select | **yes** | `select.tsx:65` `… border bg-popover text-popover-foreground shadow-md …` |
| Command | **yes** | `command.tsx:24` `… rounded-md bg-popover text-popover-foreground` |
| Dialog | **no** | `dialog.tsx:64` `… border bg-background p-6 shadow-lg …` — `bg-background`, no `popover` |
| Tooltip | **no** | `tooltip.tsx:45` `… rounded-md bg-foreground … text-background …` |

Omitted consumers that **do** use the pair (add if the list is meant to be closed):

| Component | File:line |
| --- | --- |
| ContextMenu | `context-menu.tsx:88`, `:105` |
| Combobox | `combobox.tsx:119` |
| HoverCard | `hover-card.tsx:35` |
| Menubar (content / subcontent, not the bar) | `menubar.tsx:82`, `:251` |
| NavigationMenu (viewport / non-viewport content) | `navigation-menu.tsx:94`, `:115` |

Same overlay family as Dialog, **not** popover: Sheet `sheet.tsx:63` `bg-background`; Drawer `drawer.tsx:59` `bg-background`; AlertDialog `alert-dialog.tsx:61` `bg-background`. Menubar’s *trigger row* is `menubar.tsx:17` `bg-background`.

Corrected (skill voice): *`--popover` / `--popover-foreground` are used by Popover, DropdownMenu, Select, Command, ContextMenu, Combobox, HoverCard, Menubar content, and NavigationMenu. Dialog / Sheet / Drawer use `bg-background`. Tooltip uses `bg-foreground text-background`.*

**WRONG** (Dialog, Tooltip) — **source-read**. Command is correct; the official token table’s ContextMenu omission in the skill is still a hole.

---

## 6. Biome `useSortedClasses` and custom utilities

Skill (`editor.md`): *"it only understands the **default** Tailwind config — it cannot see your `@theme`, custom utilities, or variants."*

`02-claim-audit.md` already had nursery + unsafe. This run tests the blindness.

Installed `@biomejs/biome@2.5.9` in `%TEMP%\gap08\biome` (`npx biome --version` → `Version: 2.5.9`). `npx biome explain useSortedClasses`: category `lint/nursery/useSortedClasses`, fix **unsafe**, “Custom utilities and variants (such as ones introduced by Tailwind CSS plugins). Only the default Tailwind CSS configuration is supported.”

Shipped options in this version’s `configuration_schema.json` `UseSortedClassesOptions`: **`attributes`** and **`functions` only** (`additionalProperties: false`). No stylesheet / `@theme` / Tailwind CSS path. The skill’s claim is not stale via a new “point it at CSS” option.

Config used:

```json
{
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": false,
      "nursery": {
        "useSortedClasses": {
          "level": "error",
          "fix": "unsafe"
        }
      }
    }
  }
}
```

Input (`input.jsx`) sat next to a `globals.css` that defined `@theme { --color-brand: … }`, `@utility wiggly`, and `@custom-variant polar`. Biome does not read that CSS for this rule.

```jsx
export function Demo() {
  return (
    <>
      <div className="p-4 wiggly flex polar:bg-red-500 hover:underline mt-2 bg-brand" />
      <div className="flex p-4 mt-2" />
    </>
  );
}
```

`npx biome check input.jsx` (verbatim; formatter also flagged a UTF-8 BOM from the Windows write — ignored):

```text
input.jsx:4:22 lint/nursery/useSortedClasses  FIXABLE  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × These CSS classes should be sorted.

    2 │   return (
    3 │     <>
  > 4 │       <div className="p-4 wiggly flex polar:bg-red-500 hover:underline mt-2 bg-brand" />
      │                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

  i Unsafe fix: Sort the classes.

    4   │ - ······<div·className="p-4·wiggly·flex·polar:bg-red-500·hover:underline·mt-2·bg-brand"·/>
      4 │ + ······<div·className="wiggly·mt-2·flex·bg-brand·polar:bg-red-500·p-4·hover:underline"·/>

input.jsx:5:22 lint/nursery/useSortedClasses  FIXABLE  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × These CSS classes should be sorted.

  > 5 │       <div className="flex p-4 mt-2" />
      │                      ^^^^^^^^^^^^^^^

  i Unsafe fix: Sort the classes.

    5   │ - ······<div·className="flex·p-4·mt-2"·/>
      5 │ + ······<div·className="mt-2·flex·p-4"·/>
```

`npx biome check input.jsx --write --unsafe` → `Checked 1 file in 3ms. Fixed 1 file.` After:

```jsx
export function Demo() {
	return (
		<>
			<div className="wiggly mt-2 flex bg-brand polar:bg-red-500 p-4 hover:underline" />
			<div className="mt-2 flex p-4" />
		</>
	);
}
```

What that sort did:

- Stock control `flex p-4 mt-2` → `mt-2 flex p-4` (sensible default order).
- Novel `@utility` name `wiggly`: not a known class → parked **first**, not interleaved with display/spacing.
- `@theme` colour `bg-brand`: treated as a stock `bg-*` (sits with backgrounds). The rule never opened `globals.css`; prefix matching impersonates a default utility.
- `@custom-variant polar:`: **misplaced** — `polar:bg-red-500` landed *between* `bg-brand` and `p-4`, not with `hover:underline` at the end.

It does not sort custom utilities “sensibly” against the stylesheet. Unknown names go first; names that share a stock prefix are sorted as if they were default; unknown variants can land in the middle of utilities.

**CONFIRMED** — **tool-run** (Biome 2.5.9). No stylesheet option to make the claim stale.

---

## Merge table (for `CLAIMS.md`)

| Claim | Verdict | Method |
| --- | --- | --- |
| `h-screen` ignores mobile chrome; use `h-dvh` | **CONFIRMED** (`100vh` / `100dvh`; `h-svh`/`h-lvh` also exist). Chrome behaviour is spec/MDN, not the compile. | compiled + documented |
| `line-clamp-*` never wants a width constraint or `whitespace-nowrap` | **OVERSTATED** — nowrap/`truncate` defeat clamp; a width constraint is fine | compiled |
| `next-themes` `attribute="class"` toggles `.dark` on `<html>` | **CONFIRMED** on 0.4.6; API unchanged; default is still `data-theme` | source-read |
| `sm:hidden md:block` = hidden on small, shown md+ | **OVERSTATED** — visible below `sm`; hidden `sm`–`md`; shown md+. Breakpoints 40rem / 48rem, both `width >=` | compiled |
| Dialog, Command, Tooltip consume `--popover` | **WRONG** for Dialog and Tooltip; Command yes. Also add ContextMenu, Combobox, HoverCard, Menubar, NavigationMenu | source-read |
| Biome cannot see `@theme` / custom `@utility` / `@custom-variant` | **CONFIRMED** on 2.5.9; options are still only `attributes`/`functions` | tool-run |
