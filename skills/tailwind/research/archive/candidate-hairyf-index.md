> **Archive stub.** The full dump was removed — it was ~420 lines of someone else's published skill
> republished verbatim inside an MIT repo. Read it at the source instead. Evaluation:
> [findings-cursor-index.md](findings-cursor-index.md). Sibling reject:
> [candidate-12rules.md](candidate-12rules.md). Index: [README.md](README.md).

# Candidate: hairyf/skills `tailwindcss` (rejected)

**Source:** <https://github.com/hairyf/skills/tree/HEAD/skills/tailwindcss>
Self-described Tailwind v4.1.18, generated 2026-01-28. Read at `HEAD` on 2026-08-18.

A generated docs mirror: an always-on `SKILL.md` acting as a table of contents into ~35 reference
files that restate tailwindcss.com — Width, Padding, Flexbox, and so on.

## Why it was rejected

Three reasons, in order of weight:

1. **It teaches names the model already knows.** An index of utility categories does not change what
   an agent emits. Ours is house style plus anti-patterns, and deliberately does not clone the docs.
2. **It is a stale snapshot.** At read time the gradient reference still taught `bg-gradient-to-r`,
   renamed to `bg-linear-to-*` in v4. Pointing an agent at a frozen mirror is worse than pointing it
   at nothing, because it looks authoritative.
3. **Its always-visible Upgrade Guide pointer is actively dangerous.** v3→v4 rename tables
   (`shadow` → `shadow-sm`, `ring` → `ring-3`) get applied to code that is already v4. This is the
   direct ancestor of the skill's "never run the rename table on v4 code" rule.

Cost was roughly 3.8k always-on tokens for all of that.

## What was salvaged

Two anti-confusion one-liners, both of which the candidate got right:

- **`@custom-variant` defines a variant; `@variant` applies an existing one.** Agents trained on the
  v4 beta still write `@variant name (selector)`. Now in `tailwind/SKILL.md`.
- **`@md:` is a container query, not a breakpoint** — different mechanism, different size. Now in
  `tailwind/references/gotchas.md`, expanded with a decision rule from `../03-container-queries.md`.

Nothing else. The reasoning, the per-file verdict table and every supporting URL are in
[findings-cursor-index.md](findings-cursor-index.md), which quotes what it needed.
