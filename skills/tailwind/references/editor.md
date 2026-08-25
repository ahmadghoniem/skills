# Editor and linter setup

Read this when setting up a project's tooling, when the user asks about class sorting / linting, or when autocomplete isn't working inside `cva()` / `cn()`.

Contents:

- IntelliSense inside `cva`/`cn` — always recommend
- Detect what the project already uses
- Canonical classes (rewriting)
- The rest of the rule set worth enabling
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

**Use `eslint-plugin-better-tailwindcss`, not `eslint-plugin-tailwindcss`, and never both.** The older plugin did reach v4 (4.4.0, Aug 2026), so any survey turns up two live options and it reads like a real choice. Compared rule-for-rule against 4.7.0: **7 of its 9 rules have direct equivalents** (`enforces-canonical-classname`, `enforces-shorthand`, `no-contradicting-classname`, `classnames-order`, `important-modifier-suffix`, `no-custom-classname`, `no-unnecessary-arbitrary-value`), `no-arbitrary-value` is approximable with `no-restricted-classes`, and only **`enforces-negative-arbitrary-values`** has no counterpart. Going the other way, `better-tailwindcss` has ten rules with nothing on the other side, including `no-concatenated-classes` and `no-deprecated-classes`. Running both means two canonicalisers emitting conflicting fixes on the same line. If that one rule genuinely matters, add it *and* explicitly disable its seven overlaps.

Recommend **`eslint-plugin-better-tailwindcss`**, rule `enforce-canonical-classes`. It calls Tailwind's own `canonicalizeCandidates` API — the same one powering the VS Code "suggest canonical classes" hint — and is autofixable via `eslint --fix`. It ships in the plugin's `recommended` config.

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
}
```

**`entryPoint` is not optional for this house style.** The plugin's own description: *"The path to the css entry point of the project. If not specified, the plugin will fall back to the default tailwind classes."* Without it the rule lints against stock Tailwind and cannot see your `@theme` tokens or a customised `--spacing` — so it reasons about a theme the project doesn't have.

**`rootFontSize` is the one that changes the most output, and setting it is not restating a default.** The options table's default is `undefined`; the prose's "by default, the root font size is `16px` unless it is changed with CSS" describes the *browser's* root font size, not the option's default. Read together: leave the option out and the rule has no px basis to reason from, so it skips px rewrites entirely. Verified empirically — same file, same rule: `p-[16px]` and `translate-y-[2px]` produce **zero** warnings without it, and both rewrite with it. Set `rootFontSize: 16` explicitly; that is what turns px rewrites on. (Re-checked against the rule's docs 2026-08-25.)

`collapse: true` is the plugin default and is what this house style wants — it produces the same shorthands the cleanup pass auto-applies. Note this is *stricter* than the VS Code hint, which canonicalises one class at a time and so never suggests list-level collapses. If you specifically want editor parity instead, set `collapse: false, logical: false`.

With `collapse: true`, turn off `enforce-shorthand-classes`, `enforce-consistent-important-position` and `enforce-consistent-variable-syntax` — the plugin's own docs say canonical supersedes all three, and leaving them on produces duplicate reports and conflicting fixes.

**Lint one directory at a time — a whole-project run silently under-reports.** Measured on plugin 4.7.0 / ESLint 10.9.1: linting four top-level source directories separately produced **26** findings; `eslint .` over the same tree produced **8**. `enforce-canonical-classes` stops reporting as soon as the run spans more than one top-level directory. It does not error — it returns nothing, while `no-restricted-classes` keeps working, so the run looks healthy and the exit code is unchanged. Chain the invocations in the npm script (`eslint app && eslint features && …`) rather than passing `.`, and if a run comes back suspiciously clean, re-run one directory and compare before believing it.

Without ESLint a project has **no** canonical enforcement at all. Say that plainly rather than implying a formatter covers it.

Do this with `eslint --fix`, never `@tailwindcss/upgrade` — that is a v3→v4 migration tool that rewrites every `.css` file including `globals.css`, and it doesn't do the px→scale rewrites anyway.

## The rest of the rule set worth enabling

`enforce-canonical-classes` handles syntax. Three more rules in the same plugin cover things it cannot see at all. Verified by running them: plugin 4.7.0, ESLint 10.9.1, all three fire on a fixture.

```js
rules: {
  // Two classes setting the same property. Reports the pair rather than
  // picking a winner, which is right - emission order decides that, not
  // markup order (see references/cleanup.md).
  "better-tailwindcss/no-conflicting-classes": "warn",

  // `bg-${color}-500` - the scanner reads source as text, so the class is
  // never generated. Silent at runtime; nothing else catches it.
  "better-tailwindcss/no-concatenated-classes": "warn",

  // House style the plugin cannot infer. Bans raw arbitrary colours and
  // fixes the mobile-viewport trap.
  "better-tailwindcss/no-restricted-classes": ["warn", {
    restrict: [
      { pattern: "^(bg|text|border|ring|fill|stroke)-\\[#", message: "Raw hex - use a semantic @theme token." },
      { pattern: "^h-screen$", fix: "h-dvh", message: "h-screen ignores mobile browser chrome." },
    ],
  }],
}
```

**`restrict` patterns are strings, and the plugin passes them to `String.match` unescaped.** So a literal `[` needs a **double** backslash in the JS source (`"-\\[#"` -> the regex `-\[#`). A single one is silently dropped by the JS string parser and ESLint dies with `Invalid regular expression: Unterminated character class` on the first file it lints. Shape is `{ pattern, fix?, message? }` - checked against the rule's schema in 4.7.0.

**Do not also enable `no-deprecated-classes`.** Tested on the same fixture: `enforce-canonical-classes` catches `bg-gradient-to-r`, `flex-grow` **and** `break-words`; `no-deprecated-classes` catches only `flex-grow`, and reports it a second time on the same line. It is a strict subset that adds duplicate output - the same reason `enforce-shorthand-classes` is turned off above.

`no-conflicting-classes` and `no-concatenated-classes` are the two with no prose substitute: a human reading a 12-class string does not reliably spot either.

**`no-concatenated-classes` has one honest false positive** — a template literal joining **complete** class names, e.g. ``className={`size-full${active ? " app-text-tool" : ""}`}``. Nothing is interpolated *into* a utility, and the appended names are often plain CSS classes Tailwind never generates anyway. The rule cannot tell that from a real `bg-${x}-500`. Suppress those individually with `eslint-disable-next-line` **and a one-line reason**; never turn the rule off, and never widen the suppression to a file.

## Class sorting

Use **`prettier-plugin-tailwindcss`** (official; v4 needs `tailwindStylesheet` pointed at your CSS entry). It is the only sorter that reads your stylesheet, so it is the only one that sees your `@theme`, custom utilities and variants.
