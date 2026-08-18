# Editor and linter setup

Read this when setting up a project's tooling, when the user asks about class sorting / linting, or when autocomplete isn't working inside `cva()` / `cn()`.

Contents:

- IntelliSense inside `cva`/`cn` — always recommend
- Detect what the project already uses
- Canonical classes (rewriting)
- Class sorting
- Never run `@tailwindcss/upgrade` on a v4 project

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

Check all of these — they are **not** mutually exclusive. Biome and ESLint commonly coexist (Biome formats and sorts, ESLint carries rules Biome lacks).

| Look for | Means |
| --- | --- |
| `eslint.config.*`, `.eslintrc*` | ESLint |
| `biome.json`, `biome.jsonc` | Biome |
| `.prettierrc*`, `prettier.config.*`, a `prettier` key in `package.json`, or `prettier` in devDependencies | Prettier |

Recommend against what's installed; don't propose replacing a working setup.

## Canonical classes (rewriting)

**Sorting and canonicalising are different jobs.** Prettier and Biome only *reorder* classes. Neither rewrites a non-canonical form into its first-class equivalent. Only an ESLint rule does that.

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

**`rootFontSize` is the one that changes the most output.** The plugin's docs contradict themselves here — the options table says the default is `undefined`, the prose underneath says "by default the root font size is 16px". The table is right, verified empirically: on the same file with the same rule, `p-[16px]` and `translate-y-[2px]` produce **zero** warnings without it and both rewrite with it. Set it explicitly.

`collapse: true` is the plugin default and is what this house style wants — it produces the same shorthands the cleanup pass auto-applies. Note this is *stricter* than the VS Code hint, which canonicalises one class at a time and so never suggests list-level collapses. If you specifically want editor parity instead, set `collapse: false, logical: false`.

If the project also enables `better-tailwindcss/enforce-shorthand-classes`, turn it off. Both rules' docs say so: `enforce-canonical-classes` says that with `collapse: true` you should "disable the `better-tailwindcss/enforce-shorthand-classes` rule to avoid duplicate reports", and `enforce-shorthand-classes` says the two "might interfere … use only one of them to avoid conflicting fixes". They do the same job — `pt-4 pr-4 pb-4 pl-4` → `p-4`, `w-4 h-4` → `size-4`.

A Biome-only project has **no** canonical enforcement. Either add ESLint alongside it for this rule, or state the gap plainly rather than implying Biome covers it.

## Class sorting

Pick one, don't stack both:

- **Prettier** → `prettier-plugin-tailwindcss` (official; v4 needs `tailwindStylesheet` pointed at your CSS entry).
- **Biome** → the `useSortedClasses` rule. Two caveats: it is still in `nursery` with its autofix marked **unsafe** (opt in with `"useSortedClasses": { "level": "error", "fix": "safe" }` if you want `biome check --write` to apply it), and it only understands the **default** Tailwind config — it cannot see custom utilities or variants, which matters under a `@theme`-heavy house style.

## Never run `@tailwindcss/upgrade` on a v4 project

It is a v3→v4 migration tool, and blog posts recommending it as a "canonical classes" formatter are wrong on the details:

- **No templates-only mode.** `--force` only skips the dirty-git check.
- It adds `tailwindcss@latest` and touches the lockfile. Its helper defaults to **`dependencies`**, so a fresh add lands there rather than devDependencies; where the package already exists the package manager updates it in place.
- It rewrites **every** `.css` file it finds, `globals.css` and `@theme` included.
- It scans `**/*` for templates — far wider than your `@source`.
- It calls `canonicalizeCandidates` with **no options**, so the px→scale rewrites (`translate-y-[2px]` → `translate-y-0.5`) don't even happen.

Use the ESLint rule above instead. If a one-shot rewrite is genuinely needed, run `eslint --fix` across the codebase.
