> **Archive pointer.** Pair: [research-canonical-classes.md](research-canonical-classes.md), [research-cli-enforcement.md](research-cli-enforcement.md). Index: [README.md](README.md).

# `@tailwindcss/upgrade` on an already-v4 project: class canonicalisation only?

**Verdict:** `npx @tailwindcss/upgrade` **does** run template class-rewrites on v4, but it is **not** a templates-only tool. There is **no CLI flag** to skip CSS, config, or `package.json`. Recommend **against** using it as a “canonical classes” formatter on an already-v4 codebase. Use an ESLint rule that calls `DesignSystem.canonicalizeCandidates` instead.

Exact command if you ignore that and still run it (new branch, clean git, review the full diff including lockfile):

```bash
npx -y @tailwindcss/upgrade@latest
```

`--force` only skips the dirty-git check. It does **not** mean “templates only”.

Sources read from `github.com/tailwindlabs/tailwindcss` **`main`** (tree SHA `90f8ff41…`, 2026-08-18). Package versions on that tree: `packages/tailwindcss/package.json` = `4.3.3`; `packages/@tailwindcss-upgrade/package.json` = `4.1.18` (version field on the upgrade package looks stale relative to the CSS package).

Legend: **VERIFIED** = read in source. **INFERRED** = follows from that source without a dedicated test.

---

## Bottom line (why)

| Claim | Reality |
| --- | --- |
| Blog: run upgrade on v4 to auto-apply IntelliSense “suggest canonical classes” | **Partially true.** Template migrations **do** run on v4, including a final `canonicalizeCandidates` pass. |
| Same transforms as VS Code | **False for px→scale.** IntelliSense passes `{ rem: rootFontSize }`. The upgrade CLI calls `canonicalizeCandidates([raw])` with **no options**. Official tests: `m-[16px]` stays `m-[16px]` without `rem`; becomes `m-4` with `{ rem: 16 }`. So `translate-y-[2px]` → `translate-y-0.5` is an IntelliSense/ESLint thing, **not** guaranteed from the upgrade CLI. The variant rewrite `[&>[role=checkbox]]` → `*:[[role=checkbox]]` **does not** need `rem` and **should** still apply. |
| “Just classes, skip v3→v4 migration” | **False.** No templates-only mode. CSS pipeline + `tailwindcss@latest` always run. Several v3-only steps **are** skipped (JS-config link/delete, PostCSS plugin swap, stylesheet split, preflight compat CSS, scale remaps like `rounded`→`rounded-sm`). Enough **ungated** work remains to dirty CSS and deps. |

---

## 1. What the tool does, step by step

Entry: [`packages/@tailwindcss-upgrade/src/index.ts`](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/@tailwindcss-upgrade/src/index.ts). **VERIFIED.**

1. Parse flags (`--config`, `--help`, `--force`, `--version`, optional CSS paths in `_`).
2. Unless `--force`: abort if git is dirty.
3. Print `Upgrading from Tailwind CSS v{installed}`. Abort if `package.json` expected version ≠ installed `node_modules` version.
4. Collect CSS: positional args, else `globby(['**/*.css'])` honoring gitignore / skipping `node_modules`.
5. `Stylesheet.load` each file (PostCSS parse). `analyzeStylesheets` builds import graph and marks Tailwind roots.
6. **If `version.isMajor(3)` only:** `linkConfigsToStylesheets` (`--config` / discovered `tailwind.config.*`).
7. For each Tailwind-root sheet: skip JS-config work when **not** v3 **and** no `linkedConfigPath`. Otherwise `prepareConfig` + `migrateJsConfig` (may queue **deletion** of the JS config).
8. **Always:** `migrateStylesheet` on every sheet (`canMigrate`). On non-v3 roots, compiler/designSystem are primed **before** CSS AST mutation so templates see pre-migration CSS.
9. **If v3 only:** `splitStylesheets` + cleanup of injected `layer(…)` on imports.
10. If a sheet’s serialized CSS changed vs original: `sortBuckets` + `formatNodes`.
11. **`writeFileSafely` every CSS file** (no “skip if unchanged” check).
12. **Always:** `Updating dependencies…` → `pkgManager.add([…@latest])` with `tailwindcss` **unconditionally**, plus `@tailwindcss/{cli,postcss,vite,node,oxide}` and `prettier-plugin-tailwindcss` if their names appear in `package.json`.
13. **Always (if a Tailwind-root CSS file exists):** scan sources and `migrateTemplate` each non-CSS file.
    - v4, no `source(…)`: default `{ base, pattern: '**/*' }` plus any `@source` from the compiler.
    - v3: `config.content` / `config.sources` only (no `**/*` fallback).
    - Skip `.css`, gitignored, outside-repo. Skip if `@source none` (`compiler.root === 'none'`).
14. **If v3 only:** `migratePostCSSConfig`.
15. Run cleanup (e.g. delete fully-migrated JS config). Print dirty-repo / no-changes.

Version helpers: [`packages/@tailwindcss-upgrade/src/utils/version.ts`](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/@tailwindcss-upgrade/src/utils/version.ts). `isMajor(3)` ⇔ installed `tailwindcss` satisfies `>=3.0.0 <4.0.0`.

---

## 2. Source map: class/template vs config/CSS

### Template / class (what you want)

Directory: [`packages/@tailwindcss-upgrade/src/codemods/template/`](https://github.com/tailwindlabs/tailwindcss/tree/main/packages/@tailwindcss-upgrade/src/codemods/template)

| File | Role |
| --- | --- |
| `migrate.ts` | Orchestrator: `DEFAULT_MIGRATIONS` then `designSystem.canonicalizeCandidates([raw]).pop()` |
| `candidates.ts` | Oxide extract of class candidates |
| `is-safe-migration.ts` | Skip unsafe locations |
| `migrate-canonicalize-candidate.ts` | Print/normalize candidate (`!flex` → `flex!`, whitespace in `[display:_flex_]`) |
| `migrate-handle-empty-arbitrary-values.ts` | `group-[]` → `group-[&]` so it parses |
| `migrate-prefix.ts` | v3 prefix `tw-flex` → v4 `tw:flex` |
| `migrate-simple-legacy-classes.ts` | Removed-in-v4 static aliases |
| `migrate-camelcase-in-named-value.ts` | v3 camelCase theme keys → kebab |
| `migrate-legacy-classes.ts` | v3 scale remaps (`shadow`→`shadow-sm`, …) |
| `migrate-max-width-screen.ts` | `max-w-screen-md` → `max-w-[theme(screens.md)]` |
| `migrate-variant-order.ts` | v3 variant order |
| `migrate-automatic-var-injection.ts` | `--foo` → `var(--foo)` / `bg-(--foo)` |
| `migrate-legacy-arbitrary-values.ts` | commas → spaces in `grid-cols`/`grid-rows`/`object` |
| `migrate-modernize-arbitrary-values.ts` | `group-[]` → `in-[.group]` |
| `migrate-arbitrary-variants.ts` | used in tests; **not** in `DEFAULT_MIGRATIONS` (core `canonicalizeCandidates` covers this now) |
| `migrate-theme-to-var.ts` | shared converter; used from CSS |

**The real “canonical classes” engine is not unique to the upgrade package.** It lives in [`packages/tailwindcss/src/canonicalize-candidates.ts`](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/canonicalize-candidates.ts), exposed as `DesignSystem.canonicalizeCandidates` in [`packages/tailwindcss/src/design-system.ts`](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/design-system.ts). Tests: [`packages/tailwindcss/src/canonicalize-candidates.test.ts`](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/canonicalize-candidates.test.ts). Introduced in [PR #19059](https://github.com/tailwindlabs/tailwindcss/pull/19059).

### Config / CSS / package (v3→v4 baggage)

| Path | Role |
| --- | --- |
| `codemods/config/migrate-js-config.ts` | JS config → CSS `@theme` / `@plugin` / `@source`; may delete JS file |
| `codemods/config/migrate-postcss.ts` | PostCSS plugin swap (`tailwindcss` → `@tailwindcss/postcss`, drop `autoprefixer` / `postcss-import`) |
| `codemods/css/analyze.ts` | Import graph, `isTailwindRoot`, `canMigrate` |
| `codemods/css/link.ts` | Link `tailwind.config.*` to CSS (**v3 only** from CLI) |
| `codemods/css/migrate.ts` | PostCSS plugin chain |
| `codemods/css/migrate-import.ts` | Normalize `@import` URIs |
| `codemods/css/migrate-at-apply.ts` | Run **the same candidate migrations** on `@apply` |
| `codemods/css/migrate-media-screen.ts` | `@screen` / `screen()` → `@media` |
| `codemods/css/migrate-variants-directive.ts` | `@variants` → `@layer utilities` |
| `codemods/css/migrate-at-layer-utilities.ts` | `@layer utilities/components` → `@utility` (**v3 only**) |
| `codemods/css/migrate-missing-layers.ts` | Wrap unlayered rules next to `@tailwind` |
| `codemods/css/migrate-tailwind-directives.ts` | `@tailwind base/utilities` → `@import 'tailwindcss'` |
| `codemods/css/migrate-config.ts` | Inject migrated JS config into CSS |
| `codemods/css/migrate-preflight.ts` | v3 border-color compat CSS (**v3 only**) |
| `codemods/css/migrate-theme-to-var.ts` | `theme()` in CSS → `var()` / `--theme()` |
| `codemods/css/split.ts` | Split stylesheets (**v3 only** from CLI) |
| `utils/packages.ts` | `pnpm/npm/yarn/bun add pkg@latest` |

---

## 3. Already-v4, no `tailwind.config.js`

Assume installed `tailwindcss` is `>=4 <5`, CSS has `@import "tailwindcss"`, no `@config`, no JS config.

**VERIFIED from `index.ts` + `version.ts` + the CSS plugins:**

| Step | Happens on v4? |
| --- | --- |
| Link/migrate/delete `tailwind.config.js` | **No** — `linkConfigs` is `isMajor(3)` only; JS-config loop `continue`s when `!isMajor(3) && !sheet.linkedConfigPath` |
| PostCSS config rewrite | **No** — `isMajor(3)` only |
| Stylesheet split | **No** — `isMajor(3)` only |
| Preflight compat `@layer base { border-color: … }` | **No** — `migrate-preflight.ts` returns unless `isMajor(3)` |
| `@layer utilities` → `@utility` | **No** — `migrate-at-layer-utilities.ts` returns unless `isMajor(3)` |
| `rounded`/`shadow`/`blur`/`ring` scale remaps | **No** — `migrate-legacy-classes.ts` returns unless `isMajor(3)` |
| `outline-none` → `outline-hidden` | **No** on v4 — only added to the simple-legacy map when `isMajor(3)` |
| Template class migrations | **Yes**, if a Tailwind-root CSS file is found |
| `canonicalizeCandidates` on templates | **Yes** (no `rem` / `collapse`) |
| CSS migrate pipeline | **Yes** — always called |
| Write CSS files | **Yes** — every loaded `.css` |
| `package.json` / lockfile | **Yes** — always `tailwindcss@latest` |

**CSS plugins that still have effect on a typical v4 sheet (INFERRED from each plugin’s guards):**

- `migrate-import`: rewrite relative `@import` that lack `./` or `.css`.
- `migrate-at-apply`: rewrite `@apply` utilities with the **full** template migration list (including canonicalize).
- `migrate-theme-to-var`: rewrite `theme(…)` in **all declarations and some at-rule params** if a design system loaded.
- `migrate-tailwind-directives`: no-op unless leftover `@tailwind` / `tailwindcss/base` imports exist; **can** append `prefix(…)` onto `@import 'tailwindcss'` if `newPrefix` is set (usually null on CSS-only v4).
- `migrate-media-screen`: **no-op** unless `userConfig` is set (`if (!designSystem \|\| !userConfig) return`). Typical v4 CSS-only project: skipped.
- `migrate-missing-layers`: **likely no-op** on a clean `@import "tailwindcss"` + `@theme` file (empty `lastLayer` / `firstLayerName` → buckets skipped). **Can wrap** leftover unlayered rules if old `@tailwind` directives are still present.
- `migrate-variants-directive`: only if `@variants` exists (v2/v3 leftover).

`isTailwindRoot` is set in `analyze.ts` from `@config`, `@tailwind`, or `@import "tailwindcss"` (comment + walk in that file). **VERIFIED** that the CLI keys template work off `sheet.isTailwindRoot`; **partially truncated** fetch of the exact `@import "tailwindcss"` matcher, but the CLI v4 source-detection comment assumes a root stylesheet exists.

Template file set on v4: `**/*` (Oxide scanner), minus gitignored / `.css`. **INFERRED blast radius:** any non-ignored HTML/JS/TS/Vue/Svelte/MD/etc. Oxide can extract candidates from.

---

## 4. Class-level transforms (named, with examples)

Pipeline in `DEFAULT_MIGRATIONS` then a **mandatory** `canonicalizeCandidates` pass. [`migrate.ts`](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/@tailwindcss-upgrade/src/codemods/template/migrate.ts). **VERIFIED.**

### Runs on v4 (not gated)

From upgrade-package tests unless noted.

| Migrator | Example |
| --- | --- |
| `migrateEmptyArbitraryValues` | `group-[]:flex` → `group-[&]:flex` (parse fix; later steps may rewrite further) |
| `migrateCanonicalizeCandidate` | `[display:_flex_]` → `[display:flex]`; `!flex` → `flex!` |
| `migrateSimpleLegacyClasses` | `overflow-ellipsis` → `text-ellipsis`; `flex-grow` → `grow`; `flex-shrink-0` → `shrink-0`; `decoration-clone` → `box-decoration-clone`; `bg-left-top` → `bg-top-left` (comment: “Since v4.1.0”) |
| `migrateMaxWidthScreen` | `max-w-screen-md` → `max-w-[theme(screens.md)]` (later canonicalize/theme-to-var may modernize) |
| `migrateAutomaticVarInjection` | `[color:--my-color]` → `[color:var(--my-color)]`; `bg-[--my-color]` → `bg-(--my-color)`; `supports-[--test]:flex` → `supports-(--test):flex` |
| `migrateLegacyArbitraryValues` | `grid-cols-[auto,1fr]` → `grid-cols-[auto_1fr]` |
| `migrateModernizeArbitraryValues` | `group-[]:flex` → `in-[.group]:flex`; `peer-[]:flex` → `peer-[&]:flex` |
| `designSystem.canonicalizeCandidates` | See core tests below. **Called with no options.** |

### Skipped on v4 (`isMajor(3)` guard) — **VERIFIED**

| Migrator | Would have done (v3 tests) |
| --- | --- |
| `migratePrefix` | `tw-flex` → `tw:flex` |
| `migrateCamelcaseInNamedValue` | `text-superRed` → `text-super-red` |
| `migrateLegacyClasses` | `shadow` → `shadow-sm`; `shadow-sm` → `shadow-xs`; `rounded` → `rounded-sm`; `blur` → `blur-sm`; `ring` → `ring-3`; `outline` → `outline-solid` |
| `migrateVariantOrder` | Reorder mixed at-rule / combinator / pseudo-element variants (gated because v4→v4 would flip-flop) |
| `outline-none` alias | Only injected into simple-legacy map on v3: `focus:outline-none` → `focus:outline-hidden` |

### What `canonicalizeCandidates` itself does (core tests)

Default **test** options are `{ rem: 16, collapse: true, logicalToPhysical: true }`. The **upgrade CLI does not pass those**. Examples from `canonicalize-candidates.test.ts` (many require `rem`/`collapse` to match):

| Before | After | Needs |
| --- | --- | --- |
| `[display:_flex_]` | `flex` | no rem |
| `[color:red]` | `text-[red]` | no rem |
| `[color:var(--color-red-500)]` | `text-red-500` | no rem |
| `bg-[theme(colors.red.500)]` | `bg-red-500` | no rem |
| `bg-gradient-to-t` | `bg-linear-to-t` | no rem |
| `overflow-ellipsis` | `text-ellipsis` | no rem |
| `break-words` | `wrap-break-word` | no rem |
| `[&>*]:flex` | `*:flex` | no rem (variant modernize in `modernizeArbitraryValuesVariant`) |
| `[&_[data-visible]]:flex` | `**:data-visible:flex` **INFERRED** from source comments; exact string from PR #19176 family | no rem |
| `[&>[role=checkbox]]:flex` | `*:[[role=checkbox]]:flex` **INFERRED** from `[&>_[attr]]` → `*:…` in `canonicalize-candidates.ts` (blog’s example) | no rem |
| `[&:has([role=checkbox])]:flex` | `has-[[role=checkbox]]:flex` | [commit `73f3a6a`](https://github.com/tailwindlabs/tailwindcss/commit/73f3a6a74336b5d74ff69cae5465714650f1d2e3) |
| `m-[16px]` | `m-4` | `{ rem: 16 }` |
| `mt-2 mr-2 mb-2 ml-2` | `m-2` | `{ collapse: true }` |
| `w-4 h-4` | `size-4` | `{ collapse: true }` |
| `mr-2 ml-2` | `mx-2` | collapse + `logicalToPhysical` |

Blog example combined:

```diff
- [&>[role=checkbox]]:translate-y-[2px]
+ *:[[role=checkbox]]:translate-y-0.5
```

- Variant half: **expected from upgrade CLI** (INFERRED from canonicalizer source).
- `2px` → `0.5`: **IntelliSense**, because it passes `rem: settings.tailwindCSS.rootFontSize` ([`canonical-classes.ts` in tailwindcss-intellisense](https://github.com/tailwindlabs/tailwindcss-intellisense/blob/main/packages/tailwindcss-language-service/src/diagnostics/canonical-classes.ts)). **Not** from upgrade CLI (VERIFIED: no options + core test that px stays px without `rem`).

Safety net after migrations: if the result has no utility signature, the original string is kept (`UTILITY_SIGNATURE_KEY` check in `migrate.ts`). `isSafeMigration` can also refuse a rewrite based on source location.

---

## 5. CLI flags

Defined in `index.ts` `options`. **VERIFIED. No templates-only flag.**

| Flag | Meaning |
| --- | --- |
| `--help` / `-h` | Usage (`npx @tailwindcss/upgrade`) |
| `--force` / `-f` | Allow dirty git |
| `--config` / `-c` | JS config path (v3 linking) |
| `--version` / `-v` | Version |
| positional `*.css` | Limit **which CSS files** to load; templates still run for every Tailwind root among those files |

`--help` implementation: `./commands/help` (file was 404 on raw fetch of `help.ts`; the options object in `index.ts` is the source of truth).

Official docs still frame the tool as **v3→v4**: https://tailwindcss.com/docs/upgrade-guide — `npx @tailwindcss/upgrade`, Node 20+, new branch, review diff. No “v4 canonicalize only” mode.

---

## 6. Standalone package / programmatic API?

**No public “class codemods only” package.** **VERIFIED:**

```json
// packages/@tailwindcss-upgrade/package.json
"bin": "./dist/index.mjs",
"exports": { "./package.json": "./package.json" }
```

CLI-only. `migrateCandidate` / `DEFAULT_MIGRATIONS` are **not** exported from the published package.

Programmatic equivalent of **canonical classes** (unstable, but this is what ESLint plugins use):

```ts
import { __unstable__loadDesignSystem } from '@tailwindcss/node' // also used internally by the upgrade tool

const ds = await __unstable__loadDesignSystem(css, { base })
ds.canonicalizeCandidates(['[&>[role=checkbox]]:translate-y-[2px]'], { rem: 16 })
// IntelliSense: rem: settings.tailwindCSS.rootFontSize, no collapse
// ESLint better-tailwindcss: rem / collapse / logical options
```

`CanonicalizeOptions`: `rem?`, `collapse?`, `logicalToPhysical?` in `canonicalize-candidates.ts`. Re-exported from `packages/tailwindcss/src/intellisense.ts`. The `tailwindcss` package **does not** export a dedicated `./canonicalize` subpath in `package.json` `exports` — you go through a loaded `DesignSystem`.

---

## 7. Risks on a v4 project

**VERIFIED unless marked inferred.**

1. **`package.json` / lockfile always mutated toward `@latest`.** `tailwindcss` is always in the add list. `pkg().add()` defaults to **`dependencies`**, not `devDependencies` (`utils/packages.ts`). **INFERRED:** a `devDependency` `tailwindcss` may be re-added as a runtime dependency. Also bumps `@tailwindcss/*` and `prettier-plugin-tailwindcss` if those strings appear in `package.json`.
2. **Every discovered `.css` is written** via `writeFileSafely` (temp file + rename). Even no-op migrations can change mtime; PostCSS plugins can still rewrite `@import`, `@apply`, `theme()`.
3. **`globals.css` / `@theme` / `@custom-variant`:** not specially protected. `migrate-theme-to-var` walks all decls. `migrate-at-apply` rewrites `@apply`. Custom variants in CSS are not a v3-gated skip. **INFERRED:** unusual `@import` quoting/paths can change. A leftover `@tailwind` or `@layer utilities` is more dangerous than a clean v4 file.
4. **Templates: `**/*` scan** — far wider than a typical `@source`. Gitignored files skipped; generated output that is **not** gitignored can be rewritten.
5. **Semantic class changes even without v3 scale remaps:** `flex-grow`→`grow`, `bg-gradient-to-*`→`bg-linear-to-*`, `break-words`→`wrap-break-word`, important-marker move, var() injection. Signature check reduces but does not eliminate “looks equivalent, team didn’t want it”.
6. **Mismatch with IntelliSense:** CLI won’t apply `rem`-based px→spacing or `collapse` shorthands; VS Code will still nag after the CLI run.
7. **Requires clean git** unless `--force`. Official advice: new branch, visual QA (upgrade guide).

The blog ([jimmy.codes, 2025-12-21](https://www.jimmy.codes/blog/auto-apply-suggested-tailwind-canonical-classes)) is right that templates get canonicalised; it **omits** dep bumps, CSS writes, `**/*` scan, and the `rem` gap.

---

## 8. Alternatives (canonical rewrite vs sort)

| Tool | What it actually does | Maturity | Autofix |
| --- | --- | --- | --- |
| **eslint-plugin-better-tailwindcss** `enforce-canonical-classes` | **Rewrite** via `canonicalizeCandidates`. Docs: identical to IntelliSense `suggestCanonicalClasses`. Options: `rootFontSize` (default **undefined**), `collapse` **default true**, `logical` **default true**. Peer `tailwindcss ^3.3 \|\| ^4.1.17`. | **Shipped**, not “upcoming”. npm **4.7.0** (fetched 2026-08-18), ~732k weekly. In **recommended**. [docs](https://github.com/schoero/eslint-plugin-better-tailwindcss/blob/main/docs/rules/enforce-canonical-classes.md) · [v4.0.0](https://github.com/schoero/eslint-plugin-better-tailwindcss/releases/tag/v4.0.0) | **Yes** (`autofix: true`) |
| **eslint-plugin-tailwind-canonical-classes** | **Rewrite** via official API. JSX/TSX/Svelte/Vue, `cn`/`clsx`/`cva`. | npm **1.4.1**, ~27k–44k weekly (registry vs page disagreed). Smaller than better-tailwindcss. [repo](https://github.com/MaisonnatM/eslint-plugin-tailwind-canonical-classes) | **Yes** (`eslint --fix`) |
| **eslint-plugin-tailwind-canonical** | Same idea; `cssPath` required. | npm **1.0.2**, **~32 weekly**. Thin. [repo](https://github.com/septem1997/eslint-plugin-tailwind-canonical) | **Yes** |
| **eslint-plugin-tailwindcss** (Massart) | Order, shorthand, `no-unnecessary-arbitrary-value` (`m-[1.25rem]`→`m-5`). **No** `canonicalizeCandidates` rule in the README fetched. v4 = **beta**. Issue [#426](https://github.com/francoismassart/eslint-plugin-tailwindcss/issues/426) was a request, not a shipped canonical rule. | Mature for v3; v4 incomplete | shorthand/order: yes |
| **prettier-plugin-tailwindcss** | **Sort only** (official class order). v4 needs `tailwindStylesheet`. [repo](https://github.com/tailwindlabs/prettier-plugin-tailwindcss) | Official, mature | Format-time sort, **no** canonical rewrite |
| **Biome `useSortedClasses`** | **Sort only** (Tailwind-like order). Analogous to Prettier plugin. Still **nursery**, **unsafe** fix. [docs](https://biomejs.dev/linter/rules/use-sorted-classes/) | Unstable | Unsafe autofix sort, **no** rewrite |

Closest match to the VS Code hint: **better-tailwindcss** with `collapse: false` and `rootFontSize: 16` (IntelliSense uses `rem` only, **no** collapse — it canonicalizes **one class at a time**). better-tailwindcss defaults **do** collapse (`w-4 h-4` → `size-4`), which IntelliSense currently will **not** suggest as a list-level fix.

---

## Recommendation

- **Do not** recommend `npx @tailwindcss/upgrade` on an already-v4 app as a class formatter. It will try to **upgrade `tailwindcss` to latest**, rewrite CSS, and scan `**/*`. There is no `--templates-only`.
- **Do** recommend **eslint-plugin-better-tailwindcss** `enforce-canonical-classes` (or the smaller `eslint-plugin-tailwind-canonical-classes`) for ongoing enforcement + `--fix`. Tune options to match IntelliSense (`rootFontSize: 16`, `collapse: false`) if the goal is “apply the VS Code hint”, not “also collapse shorthands”.
- Keep **prettier-plugin-tailwindcss** / Biome for **sorting**. They do not replace canonicalisation.
- If a one-shot rewrite is required without ESLint: write a small script on `__unstable__loadDesignSystem` + `canonicalizeCandidates(classes, { rem: 16 })`. Do **not** shell out to `@tailwindcss/upgrade` for that.

If someone still runs the CLI on v4: new branch, **no `--force` unless git is clean for a reason**, pin/restore `package.json` after, and treat CSS + lockfile + every non-ignored template as in-scope for review.
