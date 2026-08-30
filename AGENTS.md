# Repo conventions

This repo is two things at once: a home for standalone skills, and a Claude Code **marketplace** advertising four plugins.

## Layout

Skills live flat, one directory each, at `skills/<name>/SKILL.md`. No bucket folders and no parallel docs tree: with five skills both are overhead. A skill's own README, if it has one, sits beside its `SKILL.md`.

Claude Code auto-discovers `skills/<name>/SKILL.md`, so `.claude-plugin/plugin.json` carries **no** `skills` array. Do not add one, and do not nest a skill a level deeper, or it stops being found.

Every skill under `skills/` is loaded unnamespaced, so those names must be globally unique. A plugin's own skills are namespaced by the plugin (`cursor:output-contract`), so those may repeat.

## Plugins

`plugins/<name>/` holds a complete Claude Code plugin: `plugin.json`, `commands/`, `agents/`, `scripts/`, its own `skills/`, and its own `tests/`, `package.json` and `CHANGELOG.md`. Each is independent and versions on its own; they share only this repo's root config.

`.claude-plugin/marketplace.json` advertises all four plugins (the skills bundle plus the three delegates). After touching either manifest, run:

```
claude plugin validate . --strict
```

## Invocation

Every `SKILL.md` is either **user-invoked** (`disable-model-invocation: true`, reachable only by typing it) or **model-invoked**. The README groups them under those two headings; keep the grouping honest when a frontmatter flag changes.

## Licence

One `LICENSE` at the root covers everything. Do not add per-skill or per-plugin licence files. The `license: MIT` field inside a `plugin.json` or `SKILL.md` frontmatter is metadata Claude Code reads, not a second copy of the licence, and stays.

## Line endings

`.gitattributes` pins `* text=auto eol=lf`. This is not cosmetic. Windows Git sets `core.autocrlf=true` system-wide, and Vite's transform rejects CRLF in some `.mjs` files at import time with `SyntaxError: Invalid or unexpected token`, while `node --check` accepts the same file, so a whole test suite can stop running while the summary still reads green. That happened in `claude-grok-delegate`. Do not remove the attribute.

## Tests

There is no CI: these plugins are Windows-opinionated and there is no contributor flow to gate. Run them by hand from the root:

```
npm run install:all   # once, per plugin, each keeps its own lockfile
npm test              # cursor + grok + agy
npm run test:agy      # or one at a time
```

Do not add npm `workspaces` to the root `package.json`. It makes `npm ci` inside a plugin directory fail outright; the `--prefix` scripts exist for that reason.

`prettier --check` fails on five files in `plugins/cursor`, and has since before this repo existed. That is known and deliberately left alone.

The skills have no test suite. `skills/tailwind/evals/` holds a trigger eval, run by hand.
