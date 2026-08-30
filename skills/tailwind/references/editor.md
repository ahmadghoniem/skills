# Editor and linter setup

Read this when setting up a project's tooling, when the user asks about class sorting / linting, or when autocomplete isn't working inside `cva()` / `cn()`.

Contents:

- IntelliSense inside `cva`/`cn` — always recommend
- Detect what the project already uses
- Canonical classes (rewriting)
- Class sorting

## IntelliSense inside `cva`/`cn`

By default, Tailwind IntelliSense doesn't complete/lint class strings passed to helper functions like `cva()`, `tv()`, or `cn()`, or nested in a `cva` variant object. Register them so it does — add to `.vscode/settings.json`:

```jsonc
{
  // Needs a recent Tailwind CSS IntelliSense extension (the classFunctions setting).
  "tailwindCSS.classFunctions": ["cva", "cx", "cn", "clsx", "tv"]
}
```

Each entry is a regex matched against the function/tag name (matches are limited to the name); the extension then gives autocomplete, hover previews, and lint warnings for the class strings inside those calls — including cva's nested variants. The biggest wins are `cva`/`tv` (which hold the variant maps); `cn`/`clsx` mainly help their inline string args. These are editor settings, so v4's CSS-first config changes nothing here (reload the window after editing). On an older extension without `classFunctions`, fall back to `tailwindCSS.experimental.classRegex` with a `cva` tuple.

## Detect what the project already uses

| Look for | Means |
| --- | --- |
| `eslint.config.*`, `.eslintrc*` | ESLint |
| `.prettierrc*`, `prettier.config.*`, a `prettier` key in `package.json`, or `prettier` in devDependencies | Prettier |

Recommend against what's installed; don't propose replacing a working setup.

## Canonical classes (rewriting)

**Sorting and canonicalising are different jobs.** A sorter only *reorders* classes; it never rewrites a non-canonical form into its first-class equivalent. Only an ESLint rule does that.

**Never `eslint-plugin-tailwindcss` alongside it.** The older plugin did reach v4 (4.4.0), so a survey turns up two live options — but 7 of its 9 rules duplicate `better-tailwindcss` 4.7.0, and two canonicalisers emit conflicting fixes on the same line. Only `enforces-negative-arbitrary-values` has no counterpart.

Recommend **`eslint-plugin-better-tailwindcss`**, rule `enforce-canonical-classes`. It calls Tailwind's own `canonicalizeCandidates` API — the same one powering the VS Code "suggest canonical classes" hint — and is autofixable via `eslint --fix`. It ships in the plugin's `recommended` config.

**Lint one directory at a time — `eslint .` silently under-reports.** Measured on plugin 4.7.0 / ESLint 10.9.1: four source directories linted separately produced **26** findings; `eslint .` over the same tree produced **8**. `enforce-canonical-classes` stops reporting once a run spans more than one top-level directory — it does not error, and the exit code is unchanged. Name each directory in the npm script:

```json
"lint": "eslint app && eslint features && eslint shared && eslint server",
"lint:fix": "eslint app --fix && eslint features --fix && eslint shared --fix && eslint server --fix"
```

Finish an editing or cleanup pass with `lint:fix`. If a run comes back suspiciously clean, re-run one directory and compare before believing it.

Recommended config for this house style:

```js
// eslint.config.js
settings: {
  "better-tailwindcss": {
    entryPoint: "src/app/globals.css",  // REQUIRED — see below
  },
},
rules: {
  "better-tailwindcss/enforce-canonical-classes": ["warn", {
    rootFontSize: 16,  // REQUIRED — without it every px rewrite is a no-op
    collapse: true,    // w-4 h-4 -> size-4, px-4 py-4 -> p-4  (plugin default)
    logical: true,     // plugin default
  }],
  // Two classes setting the same property. Warn, never autofix - emission
  // order decides the winner, not markup order.
  "better-tailwindcss/no-conflicting-classes": "warn",
  // `bg-${color}-500` - never generated, silent at runtime.
  "better-tailwindcss/no-concatenated-classes": "warn",
  // House style the plugin cannot infer.
  "better-tailwindcss/no-restricted-classes": ["warn", {
    restrict: [
      { pattern: "^(bg|text|border|ring|fill|stroke)-\\[#", message: "Raw hex - use a semantic @theme token." },
      { pattern: "^h-screen$", fix: "h-dvh", message: "h-screen ignores mobile browser chrome." },
    ],
  }],
}
```

**`entryPoint` is not optional for this house style.** The plugin's own description: *"The path to the css entry point of the project. If not specified, the plugin will fall back to the default tailwind classes."* Without it the rule lints against stock Tailwind and cannot see your `@theme` tokens or a customised `--spacing` — so it reasons about a theme the project doesn't have.

**`rootFontSize` is the one that changes the most output, and setting it is not restating a default.** The options table's default is `undefined`; the prose's "by default the root font size is 16px" describes the *browser*, not the option. Leave it out and the rule has no px basis to reason from, so it skips px rewrites entirely — verified: same file, same rule, `p-[16px]` and `translate-y-[2px]` produce **zero** warnings without it and both rewrite with it.

`collapse: true` is the plugin default and is what this house style wants — it produces the same shorthands the cleanup pass auto-applies. Note this is *stricter* than the VS Code hint, which canonicalises one class at a time and so never suggests list-level collapses. If you specifically want editor parity instead, set `collapse: false, logical: false`.

With `collapse: true`, turn off `enforce-shorthand-classes`, `enforce-consistent-important-position`, `enforce-consistent-variable-syntax` and `no-deprecated-classes` — all four are subsets of canonical, and leaving them on produces duplicate reports and conflicting fixes.

**`restrict` patterns need a double backslash.** The plugin hands the string to `String.match` unescaped, so a single one dies with `Unterminated character class` on the first file linted.

**`no-concatenated-classes` has one honest false positive** — a template literal joining *complete* class names. Suppress per line with a reason; never disable the rule.

Without ESLint a project has **no** canonical enforcement at all. Say that plainly rather than implying a formatter covers it.

Do this with `eslint --fix`, never `@tailwindcss/upgrade` — that is a v3→v4 migration tool that rewrites every `.css` file including `globals.css`, and it doesn't do the px→scale rewrites anyway.

## Class sorting

Use **`prettier-plugin-tailwindcss`** (official; v4 needs `tailwindStylesheet` pointed at your CSS entry). It is the only sorter that reads your stylesheet, so it is the only one that sees your `@theme`, custom utilities and variants.
