# tailwind-skill

A [Claude Code](https://claude.com/claude-code) skill that teaches an agent a consistent, **Tailwind CSS v4 + shadcn** house style and gives it a class-list **cleanup pass** — so generated markup uses semantic tokens instead of the usual AI failure modes (v3 config hallucinations, raw hex, arbitrary values, `dark:` spam, dynamic class names that never compile).

Built and hardened from research into how coding agents (Claude, Cursor, Copilot, v0, Windsurf, …) actually get Tailwind wrong, then cross-checked against the official Tailwind v4 and shadcn/ui docs.

## What it does

**1. Reference (always-on).** While writing or editing Tailwind, the skill enforces a house style:

- **v4 only** — never emits v3 patterns (`tailwind.config.js`, `@tailwind` directives, `content`/purge, `darkMode: 'class'`, PostCSS/autoprefixer).
- **shadcn semantic-token system** — `@custom-variant dark (&:is(.dark *))`, `@theme inline`, OKLCH tokens in `:root`/`.dark`, `next-themes`. Authors with `bg-background` / `bg-primary` / `text-muted-foreground`, so `dark:` is rare.
- **A colour ladder** — semantic token for roles → soft-allow the nearest stock palette shade for decorative one-offs → promote to `@theme` when a colour carries meaning, themes, or repeats → never raw hex.
- **An arbitrary-value ladder** — scale step → semantic token → extract to `@theme` if repeated → arbitrary only for genuine one-offs (`calc()`, grid templates). `-px` utilities are intentional.
- **v4 gotchas** — `@apply`/`@reference` scope, `@source inline` for runtime-safelisting dynamic classes, `group`/`peer`, `h-dvh`, `truncate` width, mobile-first.

**2. Cleanup (on request).** Say *"clean up my tailwind"* / *"audit these classes"* and it:

- **Auto-applies** safe mechanical fixes (`flex flex-row`→`flex`, `px-4 py-4`→`p-4`, `w-4 h-4`→`size-4`, dedupe, overrides, on-scale arbitrary px → scale step).
- **Flags** judgment calls as candidates (token drift, off-scale values, structural no-ops) without touching them.

It also asks, rather than assumes, on two setup choices: the `cn()` implementation (standard `clsx + tailwind-merge` vs the faster `cnfast`) and restoring `cursor-pointer` on buttons (removed by v4 Preflight; shadcn ships it opt-in).

## Install

Drop the folder into your Claude Code skills directory:

```bash
git clone https://github.com/ahmadghoniem/tailwind-skill.git ~/.claude/skills/tailwind
```

Claude Code auto-discovers it. The reference half loads whenever you work with Tailwind; the cleanup half triggers on request.

## Editor setup (optional)

To get Tailwind IntelliSense inside `cva()` / `cn()`, add to `.vscode/settings.json`:

```jsonc
{
  "tailwindCSS.classFunctions": ["cva", "cx", "cn", "clsx", "tv"]
}
```

## Layout

```
tailwind/
├── SKILL.md      # the skill itself (frontmatter + instructions)
└── README.md
```

## License

MIT
