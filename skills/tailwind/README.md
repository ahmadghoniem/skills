# tailwind-skill

A [Claude Code](https://claude.com/claude-code) skill that teaches an agent a consistent, **Tailwind CSS v4 + shadcn** house style and gives it a class-list **cleanup pass** — so generated markup uses semantic tokens instead of the usual AI failure modes (v3 config hallucinations, raw hex, arbitrary values, `dark:` spam, dynamic class names that never compile).

Built and hardened from research into how coding agents (Claude, Cursor, Copilot, v0, Windsurf, …) actually get Tailwind wrong, then cross-checked against the official Tailwind v4 and shadcn/ui docs.

## What it does

**1. Reference (always-on).** While writing or editing Tailwind, the skill enforces a house style:

- **v4 only** — never emits v3 patterns (`tailwind.config.js`, `@tailwind` directives, `content`/purge, `darkMode: 'class'`, `bg-opacity-*`, `postcss-import`/`autoprefixer`). Verified against Tailwind 4.3.3.
- **shadcn semantic-token system** — `@custom-variant dark (&:is(.dark *))`, `@theme inline`, OKLCH tokens in `:root`/`.dark`, `next-themes`. Authors with `bg-background` / `bg-primary` / `text-muted-foreground`, so `dark:` is rare.
- **A colour ladder** — semantic token for roles → soft-allow the nearest stock palette shade for decorative one-offs → promote to `@theme` when a colour carries meaning, themes, or repeats → never raw hex.
- **OKLCH-only tokens** — every colour value is `oklch(L C H)` with slash alpha, stored as a complete colour function (never v3 bare channels, which don't just break `/30` — they kill the token outright). Contrast is fixed by moving lightness; out-of-gamut is fixed by lowering chroma.
- **Canonical v4 syntax** — `*:` / `**:` instead of `[&>*]:` / `[&_*]:`, `flex!` not `!flex`, `bg-(--token)` not `bg-[--token]`, and the v3→v4 renames (`bg-linear-to-r`, `grow`, `text-ellipsis`, `wrap-break-word`). Plus an explicit do-not-over-correct list, since `[&:hover]:` ≠ `hover:`, `shadow-sm` is a real v4 class that must not become `shadow-xs`, and the v3→v4 rename table must never run on v4 code.
- **An arbitrary-value ladder** — scale step → semantic token → extract to `@theme` if repeated → arbitrary only for genuine one-offs (`calc()`, grid templates). The spacing scale is unbounded (`p-18` is real), and `-px` utilities are intentional.
- **The right custom-CSS directives** — `@utility` (not `@layer utilities`), `@custom-variant` to define a variant (not the beta `@variant` form), `@config` if a JS config must exist at all.
- **v4 gotchas** — `@apply`/`@reference` scope, `@source inline` for runtime-safelisting dynamic classes, `group`/`peer`/`@container` markers, `@md:` ≠ `md:`, `h-dvh`, `truncate` needing `min-w-0` in flex, mobile-first.

**2. Cleanup (on request).** Say *"clean up my tailwind"* / *"audit these classes"* and it:

- **Auto-applies** safe mechanical fixes (`flex flex-row`→`flex`, `px-4 py-4`→`p-4`, `w-4 h-4`→`size-4`, dedupe, on-scale arbitrary px → scale step).
- **Flags** judgment calls as candidates (token drift, off-scale values, structural no-ops) without touching them — including two classes that set the same property, where the winner is decided by Tailwind's emission order rather than by which you wrote last.

It also asks, rather than assumes, on two setup choices: the `cn()` implementation (standard `clsx + tailwind-merge` vs the faster `cnfast`) and restoring `cursor-pointer` on buttons (removed by v4 Preflight; shadcn ships it opt-in).

## Install

Drop the folder into your Claude Code skills directory:

```bash
git clone https://github.com/ahmadghoniem/tailwind-skill.git ~/.claude/skills/tailwind
```

Claude Code auto-discovers it. The reference half loads whenever you work with Tailwind; the cleanup half triggers on request.

## Editor and linter setup (optional)

To get Tailwind IntelliSense inside `cva()` / `cn()`, add to `.vscode/settings.json`:

```jsonc
{
  "tailwindCSS.classFunctions": ["cva", "cx", "cn", "clsx", "tv"]
}
```

For enforcement, the skill recommends `eslint-plugin-better-tailwindcss`'s `enforce-canonical-classes` rule (autofixable, wraps Tailwind's own canonicalisation API) plus whichever class sorter the project already has — `prettier-plugin-tailwindcss` or Biome's `useSortedClasses`. Two settings are load-bearing and easy to miss: `entryPoint`, without which the rule lints against stock Tailwind instead of your `@theme`, and `rootFontSize`, without which every px rewrite silently does nothing. It explicitly warns against running `@tailwindcss/upgrade` on an already-v4 project. Details in `references/editor.md`.

## Layout

```
tailwind/
├── SKILL.md              # always-on: house style, OKLCH rules, the ladders
├── references/
│   ├── setup.md          # globals.css scaffold, build entry, next-themes, cn(), button cursor
│   ├── gotchas.md        # v4 traps
│   ├── editor.md         # IntelliSense + linter recommendations
│   └── cleanup.md        # the cleanup pass
└── README.md
```

SKILL.md stays small and always applies; the reference files load only when the situation calls for them.

## License

MIT
