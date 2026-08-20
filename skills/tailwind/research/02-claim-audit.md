> **Provenance:** **live** for source URLs. Several verdicts are **superseded** — `05-build-verification.md` compiled claims 2, 11, 23, 24; the skill was rewritten afterward. Do not copy wording from this file. Current mapping: [CLAIMS.md](CLAIMS.md).

# Task 2 — Claim audit

Lead: items that should change the skill. Then the numbered table. Extra falsifiable claims found in a sweep are at the end.

Latest **published** Tailwind is still **4.3.3** (npm + GitHub release 2026-07-16). `CHANGELOG.md` has an **Unreleased** section (turbopack package, `@scope` variant wrapping, more canonicalize rules). Nothing in Unreleased falsifies the house-style rules below except the 4.3.1 spacing-emission tweak (claim 8 / extra).

---

## Would change the skill

### 1. `setup.md` scaffold is missing current shadcn wiring (OUTDATED, HIGH)

Exact lines (`tailwind/references/setup.md` `@theme inline` block): it bridges background→ring and `sm/md/lg/xl` radius only.

Current default theme at https://ui.shadcn.com/docs/theming also ships:

- `@import "shadcn/tailwind.css";` after `@import "tailwindcss";`
- `--color-chart-1` … `--color-chart-5`
- `--color-sidebar` plus `-foreground`, `-primary`, `-primary-foreground`, `-accent`, `-accent-foreground`, `-border`, `-ring`
- `--radius-2xl` / `--radius-3xl` / `--radius-4xl` (`* 1.8` / `* 2.2` / `* 2.6`)

`--destructive-foreground` is still **absent** from the official token table (only `--destructive`). Current `buttonVariants` uses `text-destructive`, not a paired foreground token.

Corrected scaffold: copy the current “Default Theme CSS” block from the theming page (or at least add the chart + sidebar bridges and extra radius rungs, and the `shadcn/tailwind.css` import when the project is on current shadcn).

### 2. `hsl(var(--background))` is not shadcn’s prescribed v4 shape anymore (OUTDATED)

`tailwind/references/cleanup.md`: *"`hsl(var(--x))` on its own is **not** a defect — it is a complete colour, `/opacity` works against it, and it is shadcn's own prescribed v4 shape."*

The complete-colour + `color-mix` parts are still true. The “prescribed v4 shape” part is stale. Current shadcn default CSS stores **complete `oklch()`** values, not HSL channel wrappers.

Corrected: *A wrapped `hsl(var(--x))` is a complete colour and `/opacity` compiles; convert it to `oklch()` for house style. It is a leftover v3/early-v4 channel pattern, not current shadcn.*

### 3. Biome `useSortedClasses` opt-in example is wrong (WRONG)

`tailwind/references/editor.md`: *opt in with `"useSortedClasses": { "level": "error", "fix": "safe" }` if you want `biome check --write` to apply it*

The rule’s fix is **unsafe**. `"fix": "safe"` will **not** apply it. Official docs: the fix is classified unsafe and will not run as part of ordinary “fix on save”.

Corrected: keep `level: "error"` (or `warn`) and set `"fix": "unsafe"`, or tell the user to run `biome check --write --unsafe`.

### 4. `enforce-canonical-classes` now collides with more sibling rules (OUTDATED)

Skill only mentions turning off `enforce-shorthand-classes`. Plugin docs now also say disable `enforce-consistent-important-position` and `enforce-consistent-variable-syntax` when canonical is on.

### 5. Spacing compile formula is slightly stale after 4.3.1 (OUTDATED, low)

Skill: every integer compiles to `calc(var(--spacing) * N)`. From 4.3.1: `m-0`/`left-0` emit `0`; `m-1`/`left-1` emit `var(--spacing)` not `calc(var(--spacing) * 1)`. `p-18` etc. still use `calc`.

### 6. Claim 24 (`@tailwind` trio is a silent success) — do not keep as a hard fact (UNVERIFIED)

Upgrade guide: directives **removed**, replace with `@import "tailwindcss"`. A docs issue reports an **error** suggesting `@import`. Behaviour (hard error vs utilities-only, no Preflight) was not recompiled on 4.3.3 here. Soften to: *do not use the v3 trio; if you see an unstyled build or a directive error, replace with `@import "tailwindcss"`.*

### 7. Claim 11 `text-sm`/`text-lg` pair — do not keep the specific winner (UNVERIFIED)

Emission-order-not-markup is CONFIRMED. `.w-full` after `.w-32` (so `w-full` wins) is CONFIRMED for v4.1+ (`#17726`: “Now w-full is last”). The skill’s “`.text-lg` before `.text-sm` so `text-sm` wins” was not re-emitted against 4.3.3. Keep the rule “don’t assume last-in-markup”; drop or re-verify the font-size example.

---

## Numbered claims

| # | Claim | Verdict | Note | Source URL |
| --- | --- | --- | --- | --- |
| 1 | Latest v4.x; skill “verified against 4.3.3” | CONFIRMED | npm and GitHub latest **release** is 4.3.3 (2026-07-16). Unreleased work exists on `main` but is not a shipped version. 4.3.1 spacing emission (row 8) is the only post-verify nit that belongs in the skill. | https://www.npmjs.com/package/tailwindcss · https://github.com/tailwindlabs/tailwindcss/blob/main/CHANGELOG.md |
| 2 | `oklch()` has no comma form; `oklch(0.7 0.1 250, 0.5)` passes Tailwind with no warning; browser drops it | CONFIRMED (syntax) / UNVERIFIED (no warning) | MDN: `oklch(L C H[ / A])` — spaces, slash alpha. Comma form is invalid CSS and is dropped at parse. Tailwind does not document validating `oklch()` argument lists; “no warning” was not reproduced on a 4.3.3 build. | https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch |
| 3 | Bare-channel token (`--background: 0 0% 100%`) is dead in v4 for every use, not just `/opacity` | CONFIRMED | v4 colour utilities emit `background-color: var(--background)` (and `/n` uses `color-mix(..., var(--background) n%, transparent)`). Naked channels are not a `<color>`. | https://tailwindcss.com/docs/theme · https://github.com/tailwindlabs/tailwindcss/discussions/16667 |
| 4 | `hsl(var(--background))` is complete, `/opacity` → `color-mix(in oklab, …)`, and is shadcn’s prescribed v4 shape | CONFIRMED (mechanics) / OUTDATED (prescribed) | `withAlpha` wraps complete colours in `color-mix(in oklab, <color> %, transparent)`. Current shadcn theme is complete `oklch()`, not HSL channels. | https://github.com/tailwindlabs/tailwindcss/discussions/16667 · https://ui.shadcn.com/docs/theming |
| 5 | `@theme inline` emits `var(--background)` not `var(--color-background)`; without it `.dark` can be ignored (parent-scope resolution) | CONFIRMED | Docs: `inline` inlines the theme **value** into the utility. For `--color-background: var(--background)` that value is `var(--background)`. Without `inline`, the utility uses `var(--color-background)` defined on `:root`, so `var(--background)` is resolved at `:root`, not under `.dark`. | https://tailwindcss.com/docs/theme · https://github.com/tailwindlabs/tailwindcss/pull/14095 |
| 6 | Dark `--border` / `--input` hairlines; radius ladder `sm .6 / md .8 / lg 1 / xl 1.4`; `--radius: 0.625rem` | CONFIRMED + incomplete | Hairlines, `--radius: 0.625rem`, and sm/md/lg/xl multipliers match. Current default **also** defines `--radius-2xl/3xl/4xl`. | https://ui.shadcn.com/docs/theming |
| 7 | Token role list in `setup.md` complete; chart/sidebar omitted; `--destructive-foreground` absent | WRONG (completeness) / CONFIRMED (destructive-foreground) | Official table includes `chart-1..5` and the full `sidebar-*` set. `--destructive-foreground` is still not a default token. | https://ui.shadcn.com/docs/theming · https://github.com/shadcn-ui/ui/blob/b59f68ec/apps/v4/styles/base-nova/ui/button.tsx |
| 8 | Unbounded spacing (`p-18`, `mt-21`, `w-101` → `calc(var(--spacing) * N)`); open-ended `z-N`, `grid-cols-N` | CONFIRMED / OUTDATED (formula) | Padding docs: `p-<n>` → `calc(var(--spacing) * n)` except 4.3.1 special-cases 0 and 1. `z-<number>` and `grid-cols-<number>` are first-class. | https://tailwindcss.com/docs/padding · https://tailwindcss.com/docs/z-index · https://tailwindcss.com/docs/grid-template-columns · https://github.com/tailwindlabs/tailwindcss/blob/main/CHANGELOG.md |
| 9 | v4 `ring` is 1px (so `ring-3` triples it); `rounded` is hardcoded 0.25rem; `rounded-sm` is `var(--radius-sm)` | CONFIRMED | Upgrade guide: default `ring` is 1px; remapping to `ring-3` restores v3’s 3px. `rounded-sm` is `var(--radius-sm)`. Bare `rounded` is the v3-compat 0.25rem alias. Under shadcn’s `--radius-sm: calc(var(--radius) * 0.6)` they are **not** equal. | https://tailwindcss.com/docs/upgrade-guide · https://tailwindcss.com/docs/border-radius |
| 10 | `shadow-sm`, `blur-sm`, `rounded-sm`, `drop-shadow-sm`, `backdrop-blur-sm` still exist; smallest shadow is `shadow-2xs` | CONFIRMED | Default `theme.css` still defines `--shadow-2xs`, `--shadow-xs`, `--shadow-sm`. Rename table moved *v3’s* `shadow-sm` → `shadow-xs`; it did not delete `shadow-sm`. | https://tailwindcss.com/docs/theme · https://tailwindcss.com/docs/upgrade-guide |
| 11 | Same-property winner is emission order, not markup; in 4.3.3 `.w-32` before `.w-full` so `w-full` wins; `.text-lg` before `.text-sm` so `text-sm` wins | CONFIRMED (mechanism + widths) / UNVERIFIED (type scale pair) | Markup order never wins. v4 sorts by properties. `#17726` (v4.1.3): `w-full` is **last**, so it beats numbered widths. Font-size pair not recompiled. `cn()` / tailwind-merge last-in-string still wins. | https://github.com/tailwindlabs/tailwindcss/issues/17726 · https://github.com/tailwindlabs/prettier-plugin-tailwindcss/issues/378 |
| 12 | `!flex` still parses; `flex!` is canonical | CONFIRMED | Upgrade guide: put `!` at the end; “the old way is still supported for compatibility but is deprecated.” | https://tailwindcss.com/docs/upgrade-guide · https://github.com/tailwindlabs/tailwindcss/pull/13103 |
| 13 | `bg-(--token)` ≡ `bg-[var(--token)]`, including `bg-primary/(--alpha)` | CONFIRMED | Custom-property shorthand is documented; modifier form `bg-red-500/(--my_opacity)` appears in the 4.1.6 changelog (underscore bugfix). | https://tailwindcss.com/docs/adding-custom-styles · https://github.com/tailwindlabs/tailwindcss/releases/tag/v4.1.6 |
| 14 | `*:` / `**:` first-class; `*:[[role=checkbox]]:`, `*:data-open:`, `has-[...]`, `not-first:`, `odd:`, `in-*` exist as described | CONFIRMED | Variant table: `*` → `:is(& > *)`, `**` → `:is(& *)`, `has-[...]`, `odd`, `in-[...]` → `:where(...) &` (ancestor, not child). `not-` stacks with `first`. `data-*` is first-class. | https://tailwindcss.com/docs/hover-focus-and-other-states |
| 15 | `[&:hover]:` ≠ `hover:` because `hover:` wraps `@media (hover: hover)` | CONFIRMED | Variant table: `hover` = `@media (hover: hover) { &:hover }`. Upgrade guide still documents this. | https://tailwindcss.com/docs/hover-focus-and-other-states · https://tailwindcss.com/docs/upgrade-guide |
| 16 | Rename table: `bg-gradient-to-r`→`bg-linear-to-r`, `flex-grow`→`grow`, `overflow-ellipsis`→`text-ellipsis`, `break-words`→`wrap-break-word`, `decoration-clone`→`box-decoration-clone`, `bg-left-top`→`bg-top-left` | CONFIRMED | First five match upgrade guide / changelog (`break-words` → `wrap-break-word` in 4.1.x). Current bg-position utilities are `bg-top-left` (not `bg-left-top`). | https://tailwindcss.com/docs/upgrade-guide · https://tailwindcss.com/docs/overflow-wrap · https://tailwindcss.com/docs/background-position |
| 17 | `@layer utilities { .x {} }` emits the class but does not register a utility; `@utility` is correct | CONFIRMED | Adam: `@layer` is real CSS now and does not register variants. `@utility` is the registration API. GitHub `#14058`. | https://github.com/tailwindlabs/tailwindcss/issues/14058 · https://tailwindcss.com/docs/adding-custom-styles |
| 18 | `@custom-variant` defines; `@variant` applies; `@variant name (selector)` is beta syntax still silently accepted | CONFIRMED | Directives docs match the first two. PR `#15663`: old `@variant name (selector)` / `@slot` form is auto-upgraded to `@custom-variant` for compatibility. | https://tailwindcss.com/docs/functions-and-directives · https://github.com/tailwindlabs/tailwindcss/pull/15663 |
| 19 | Only PostCSS plugin is `@tailwindcss/postcss`; drop `postcss-import` + `autoprefixer`; Vite → `@tailwindcss/vite` | CONFIRMED | Upgrade guide, verbatim. | https://tailwindcss.com/docs/upgrade-guide |
| 20 | Lightning CSS targets Chrome 111 / Safari 16.4 / Firefox 128; ignores `browserslist` | CONFIRMED | Same numbers still on the upgrade guide (“designed for Safari 16.4+, Chrome 111+, Firefox 128+”). No documented `browserslist` hook. | https://tailwindcss.com/docs/upgrade-guide |
| 21 | `tailwind.config.js` not auto-detected; `@config` loads it; `corePlugins`/`safelist`/`separator` ignored; safelist → `@source inline(...)` brace syntax | CONFIRMED | Directives page + detecting-classes page. Skill example `{hover:,}bg-{red,blue,amber}-{50,{100..900..100},950}` is the same brace language as the docs’ `{hover:,}bg-red-{50,{100..900..100},950}`. | https://tailwindcss.com/docs/functions-and-directives · https://tailwindcss.com/docs/detecting-classes-in-source-files |
| 22 | `@apply` in Vue/Svelte/Astro/`<style>` / CSS modules needs `@reference`; pathological before 4.1.6; PR `#17836` | CONFIRMED | Directives: `@reference`. `#17836` “Don’t scan files for utilities when using `@reference`”, shipped in **v4.1.6**. | https://tailwindcss.com/docs/functions-and-directives · https://github.com/tailwindlabs/tailwindcss/pull/17836 · https://github.com/tailwindlabs/tailwindcss/releases/tag/v4.1.6 |
| 23 | `--spacing(6)` is build-time and hard-errors unprocessed; `calc(var(--spacing) * 6)` is runtime because `--spacing` is on `:root` | CONFIRMED (function) / UNVERIFIED (exact error string) | `--spacing()` compiles to `calc(var(--spacing) * n)`. Exact unprocessed-block error text was not re-run. `--spacing` is a default theme variable emitted on `:root`. | https://tailwindcss.com/docs/functions-and-directives · https://tailwindcss.com/docs/theme |
| 24 | v3 `@tailwind base/components/utilities` does **not** error; only `utilities` honoured → no Preflight, no theme vars | UNVERIFIED | Docs: directives **removed**. Issue `#2076` title/body talk about an **error** suggesting `@import`. Do not keep “silent success” without a 4.3.3 compile. | https://tailwindcss.com/docs/upgrade-guide · https://github.com/tailwindlabs/tailwindcss.com/issues/2076 |
| 25 | `@import "tailwindcss" important;` forces all utilities important | CONFIRMED | Documented under “Using the important flag”. | https://tailwindcss.com/docs/styling-with-utility-classes |
| 26 | `truncate` on flex/grid item needs `min-w-0` (`min-width: auto`) | CONFIRMED | Flex/grid min-size default is `auto`; overflow docs also point at `wrap-anywhere` as an alternative. The `min-w-0` trap remains. | https://tailwindcss.com/docs/overflow-wrap |
| 27 | `md:` = `@media (width >= 48rem)`; `@md:` = `@container (width >= 28rem)`; `@container` sets `container-type: inline-size` | CONFIRMED | Responsive-design tables. `@container` utility is documented as marking an inline-size container. | https://tailwindcss.com/docs/responsive-design · https://tailwindcss.com/docs/hover-focus-and-other-states |
| 28 | Dynamic `bg-${x}-500` never generated; scanner is plain text | CONFIRMED | Detecting-classes page, including the exact anti-pattern. | https://tailwindcss.com/docs/detecting-classes-in-source-files |
| 29 | `eslint-plugin-better-tailwindcss` rule `enforce-canonical-classes`; options `entryPoint`, `rootFontSize`, `collapse`, `logical`; wraps `canonicalizeCandidates`; conflict with `enforce-shorthand-classes` | CONFIRMED | Rule exists under that name. `entryPoint` is a **settings** key (`settings["better-tailwindcss"].entryPoint`). `collapse`/`logical` default `true`. Docs: identical to IntelliSense `suggestCanonicalClasses` / Tailwind canonicalize PR `#19059`. Shorthand conflict is documented. Also disable important-position + variable-syntax rules. | https://github.com/schoero/eslint-plugin-better-tailwindcss/blob/main/docs/rules/enforce-canonical-classes.md · https://github.com/schoero/eslint-plugin-better-tailwindcss/blob/main/docs/settings/settings.md |
| 30 | `rootFontSize` default is `undefined`, not 16; table beats prose | CONFIRMED | Options table: **Default: `undefined`**. Prose still says “by default the root font size is 16px”. Examples require `rootFontSize: 16` for `mt-[16px]` → `mt-4`. | https://github.com/schoero/eslint-plugin-better-tailwindcss/blob/main/docs/rules/enforce-canonical-classes.md |
| 31 | Biome `useSortedClasses` still nursery, unsafe fix, can’t see custom utilities/variants | CONFIRMED (nursery + unsafe) / UNVERIFIED (custom utilities) | Still `lint/nursery/useSortedClasses`, unsafe fix. Custom `@utility`/`@custom-variant` blindness is the historical limitation; Biome is iterating a v4 sorter (`sort_v4`) but the public rule page still warns of missing features. | https://biomejs.dev/linter/rules/use-sorted-classes/ · https://github.com/biomejs/biome/blob/main/crates/biome_js_analyze/src/lint/nursery/use_sorted_classes.rs |
| 32 | `prettier-plugin-tailwindcss` v4 needs `tailwindStylesheet` | CONFIRMED | README: “When using Tailwind CSS v4 you **must** specify” `tailwindStylesheet`. | https://github.com/tailwindlabs/prettier-plugin-tailwindcss/blob/main/README.md |
| 33 | `tailwindCSS.classFunctions` is a real VS Code setting | CONFIRMED | IntelliSense README + marketplace. Regex on function name only. | https://github.com/tailwindlabs/tailwindcss-intellisense/blob/main/packages/vscode-tailwindcss/README.md |
| 34 | `cnfast` exists; version; “byte-identical, ~3.8×, ~1 KB more gzipped” | CONFIRMED | npm **0.1.0** (published 2026-07-27, ~658k weekly downloads — not abandoned). GitHub README: 3.8× geomean on V8, 0 mismatches / 113,291 call groups, 9.43 KB vs 8.45 KB gzip (~1 KB). npm README still shows older Bun 3.2× numbers — cite GitHub, treat speed as vendor bench. | https://www.npmjs.com/package/cnfast · https://github.com/aidenybai/cnfast |
| 35 | v4 Preflight `cursor: default` on buttons; shadcn `buttonVariants` has no `cursor-pointer`; `npx shadcn init --pointer` is real | CONFIRMED | All three. Current nova `buttonVariants` has `disabled:pointer-events-none`, no `cursor-pointer`. CLI: `--pointer` / `--no-pointer`. Changelog April 2026. | https://ui.shadcn.com/docs/components/button · https://ui.shadcn.com/docs/cli · https://ui.shadcn.com/docs/changelog/2026-04-pointer-cursor · https://github.com/shadcn-ui/ui/blob/b59f68ec/apps/v4/styles/base-nova/ui/button.tsx |
| 36 | `--popover`/`--popover-foreground` used by Popover, Dialog, DropdownMenu, Select, Command, Tooltip; `--radius-xl` used by Card | CONFIRMED (partial) | Official token table: popover pair used by **Popover, DropdownMenu, ContextMenu** (Dialog/Command/Tooltip not listed there). **Select** content is `bg-popover text-popover-foreground` in current source. **Card** uses `rounded-xl`. Treat Dialog/Command/Tooltip as likely overlays, not as a closed official list. | https://ui.shadcn.com/docs/theming · https://github.com/shadcn-ui/ui/blob/15ac1be9/apps/v4/registry/new-york-v4/ui/select.tsx · https://ui.shadcn.com/docs/components/base/card |

---

## Extra falsifiable claims (sweep)

| Claim (file) | Verdict | Note | Source URL |
| --- | --- | --- | --- |
| Biome: `"fix": "safe"` applies `useSortedClasses` (`editor.md`) | WRONG | Fix is unsafe; `safe` will not apply it. | https://github.com/biomejs/biome/blob/main/crates/biome_js_analyze/src/lint/nursery/use_sorted_classes.rs |
| Canonical rule only conflicts with `enforce-shorthand-classes` (`editor.md`) | OUTDATED | Also `enforce-consistent-important-position` and `enforce-consistent-variable-syntax`. | https://github.com/schoero/eslint-plugin-better-tailwindcss/blob/main/docs/rules/enforce-canonical-classes.md |
| Every integer spacing utility is `calc(var(--spacing) * N)` (`SKILL.md`) | OUTDATED | 4.3.1: `0` and `1` special-cased. | https://github.com/tailwindlabs/tailwindcss/blob/main/CHANGELOG.md |
| `setup.md` “every remaining role” without chart/sidebar / no `shadcn/tailwind.css` | OUTDATED | Current default theme includes both. | https://ui.shadcn.com/docs/theming |
| Popover token consumers include Dialog, Command, Tooltip (`setup.md`) | UNVERIFIED (those three) | Official table names Popover / DropdownMenu / ContextMenu. Select source confirmed. | https://ui.shadcn.com/docs/theming |
