# tailwind-skill

A [Claude Code](https://claude.com/claude-code) skill that teaches an agent a consistent **Tailwind CSS v4** house style built on semantic design tokens and gives it a class-list **cleanup pass** — so generated markup uses semantic tokens instead of the usual AI failure modes (v3 config hallucinations, raw hex, arbitrary values, `dark:` spam, dynamic class names that never compile).

Built and hardened from research into how coding agents (Claude, Cursor, Copilot, v0, Windsurf, …) actually get Tailwind wrong, then cross-checked against the official Tailwind v4 and shadcn/ui docs.

## What it does

**1. Reference (always-on).** While writing or editing Tailwind, the skill enforces a house style:

- **v4 only** — never emits v3 patterns (`tailwind.config.js`, `@tailwind` directives, `content`/purge, `darkMode: 'class'`, `bg-opacity-*`, `postcss-import`/`autoprefixer`). Verified against Tailwind 4.3.3.
- **A semantic-token system** — `@custom-variant dark (&:is(.dark *))`, `@theme inline`, OKLCH tokens in `:root`/`.dark`, `next-themes`. The token names come from the project; where there is none, it scaffolds shadcn's, which is the common case. Authors with the surface / muted-text / intent token, so `dark:` is rare.
- **A colour ladder** — semantic token for roles → soft-allow the nearest stock palette shade for decorative one-offs → promote to `@theme` when a colour carries meaning, themes, or repeats → never raw hex.
- **OKLCH-only tokens** — every colour value is `oklch(L C H)` with slash alpha, stored as a complete colour function (never v3 bare channels, which don't just break `/30` — they kill the token outright). Contrast is fixed by moving lightness; out-of-gamut is fixed by lowering chroma.
- **Canonical v4 syntax** — `*:` / `**:` instead of `[&>*]:` / `[&_*]:`, `flex!` not `!flex`, `bg-(--token)` not `bg-[--token]`, and the v3→v4 renames (`bg-linear-to-r`, `grow`, `text-ellipsis`, `wrap-break-word`). Plus an explicit do-not-over-correct list, since `[&:hover]:` ≠ `hover:`, `shadow-sm` is a real v4 class that must not become `shadow-xs`, and the v3→v4 rename table must never run on v4 code.
- **An arbitrary-value ladder** — scale step → semantic token → extract to `@theme` if repeated → arbitrary only for genuine one-offs (`calc()`, grid templates). The spacing scale is unbounded (`p-18` is real), and `-px` utilities are intentional.
- **The right custom-CSS directives** — `@utility` (not `@layer utilities`), `@custom-variant` to define a variant (not the beta `@variant` form), `@config` if a JS config must exist at all.
- **v4 gotchas** — `@apply`/`@reference` scope, `@source inline` for runtime-safelisting dynamic classes, `group`/`peer`/`@container` markers, `@md:` ≠ `md:`, `h-dvh`, `truncate` needing `min-w-0` in flex, mobile-first.

**2. Cleanup (on request).** Say *"clean up my tailwind"* / *"audit these classes"* and it:

- **Auto-applies** safe mechanical fixes (`flex flex-row`→`flex`, `px-4 py-4`→`p-4`, `w-4 h-4`→`size-4`, dedupe, on-scale arbitrary px → scale step).
- **Flags** judgment calls as candidates (token drift, off-scale values, structural no-ops) without touching them — including two classes that set the same property, where the winner is decided by Tailwind's emission order rather than by which you wrote last.

It also asks, rather than assumes, on the setup choices it can't infer: the theme values themselves (it wires the token contract and defers the palette to `shadcn init` or the user), the `cn()` implementation (standard `clsx + tailwind-merge` vs the faster `cnfast`) and restoring `cursor-pointer` on buttons (removed by v4 Preflight; shadcn ships it opt-in).

## Install

Markdown only — nothing to build, no dependencies, no npm install. Clone it into your Claude Code skills directory and drop the provenance tree, which is for auditing rather than for the agent:

```bash
git clone https://github.com/ahmadghoniem/tailwind-skill.git ~/.claude/skills/tailwind
rm -rf ~/.claude/skills/tailwind/research
```

PowerShell:

```powershell
git clone https://github.com/ahmadghoniem/tailwind-skill.git "$HOME/.claude/skills/tailwind"
Remove-Item -Recurse -Force "$HOME/.claude/skills/tailwind/research"
```

Keep `research/` if you want to check a claim offline — it is inert either way (see below). Restart Claude Code, or run `/skills`; `tailwind` should be listed. Per-project instead of globally: clone to `.claude/skills/tailwind` inside the project.

### What actually loads

Only the `description` in `SKILL.md`'s frontmatter is always in context — currently **154 characters**. That is the whole always-on cost. When the model judges the skill relevant it invokes it, and *only then* does `SKILL.md`'s body load; the files in `references/` load individually, on demand, when the situation calls for one. `evals/` and `research/` are never referenced by `SKILL.md` and are never read.

Measured, not assumed: a real invocation was captured with `claude -p --output-format stream-json` and the transcript contains `SKILL.md`'s body and nothing else — no `references/`, no `research/`, no directory listing.

### Uninstall

```bash
rm -rf ~/.claude/skills/tailwind
```

## Editor and linter setup (optional)

To get Tailwind IntelliSense inside `cva()` / `cn()`, add to `.vscode/settings.json`:

```jsonc
{
  "tailwindCSS.classFunctions": ["cva", "cx", "cn", "clsx", "tv"]
}
```

For enforcement, the skill recommends `eslint-plugin-better-tailwindcss`'s `enforce-canonical-classes` rule (autofixable, wraps Tailwind's own canonicalisation API) plus `prettier-plugin-tailwindcss` for sorting. Two settings are load-bearing and easy to miss: `entryPoint`, without which the rule lints against stock Tailwind instead of your `@theme`, and `rootFontSize`, without which every px rewrite silently does nothing. Details in `references/editor.md`.

## Layout

```
tailwind/
├── SKILL.md              # house style, OKLCH rules, the ladders (body loads on invoke)
├── references/
│   ├── setup.md          # globals.css scaffold, build entry, next-themes, cn(), button cursor
│   ├── gotchas.md        # v4 traps
│   ├── editor.md         # IntelliSense + linter recommendations
│   └── cleanup.md        # the cleanup pass
├── evals/                # trigger eval — does the description actually fire the skill?
├── research/             # provenance; not installed by default — see Install
└── README.md
```

SKILL.md stays small and carries everything that must always apply once the skill is active; the reference files load individually, only when the situation calls for one.

## Why you can trust it

Coding agents state Tailwind facts confidently and wrongly, and this skill did too: shipped claims about `@apply` losing variants, a chroma ceiling its own scaffold violated, and a `data-active:` specificity story that was backwards. So the rules here are checked by compiling, not by searching.

[`research/CLAIMS.md`](research/CLAIMS.md) maps every load-bearing sentence to its evidence and marks it **compiled**, **source-read**, **tool-run** or **documented**. [`research/README.md`](research/README.md) keeps a bug ledger of everything that shipped wrong and how it was caught — the base rate is the point. Where a claim says "compiled on 4.3.3", there is an `out.css` dump behind it.

## License

MIT
