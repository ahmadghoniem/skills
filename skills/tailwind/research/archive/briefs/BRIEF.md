> **Archive.** Instruction file for round 1 (doc audit). Not findings. Outputs: `research/01`–`04`. Later rounds: [BRIEF-2.md](BRIEF-2.md), [BRIEF-3.md](BRIEF-3.md).

# Research brief — fact-check and extend the `tailwind` Claude Code skill

You are doing **research and fact-checking only**. Do **NOT** edit any file under `tailwind/`.
Write your findings to the four report files named at the bottom. That is your only write access.

## Tools

An `exa` MCP server is configured globally (`~/.cursor/mcp.json`). **Use the Exa MCP tools
(`web_search_exa` / `web_fetch_exa`) as your primary research tool** rather than any built-in
web search, so we do not hit rate limits elsewhere. Fetch primary sources (tailwindcss.com docs,
the tailwindlabs GitHub repo and its CHANGELOG, ui.shadcn.com, the plugin's own README) over
blog posts. When a claim can only be settled by running Tailwind, say so and mark it UNVERIFIED
rather than guessing.

## What you are checking

The skill lives in `tailwind/`:
- `tailwind/SKILL.md` — always-on house style
- `tailwind/references/setup.md`, `gotchas.md`, `editor.md`, `cleanup.md`

Read all five first. It is a Tailwind **v4-only** house style built on shadcn semantic tokens.

---

## Task 1 — Skill-authoring best practices (double-check, low effort)

This was researched before; confirm nothing has changed. Check Anthropic's current published
guidance on writing Claude Code / Agent Skills:
- SKILL.md frontmatter fields that are actually supported today (we use `name`, `description`,
  `license` — is anything else expected or now required? e.g. `allowed-tools`, `metadata`)
- description-field guidance (third person? trigger phrases? length limits?)
- recommended SKILL.md size / when to split into `references/`
- naming and directory conventions, and whether `evals/` is an expected folder
- any hard limits (character counts, file counts)

Report only **deltas** from what this skill already does. If it already conforms, say so in one line.

## Task 2 — Fact-check every technical claim (this is the main job)

Go claim by claim. For each, give a verdict: **CONFIRMED** / **WRONG** / **OUTDATED** /
**UNVERIFIED**, a one-line justification, and a source URL. Prioritise the ones marked (HIGH).

Start with these; then sweep the files for anything else falsifiable that I have not listed.

Version:
1. (HIGH) What is the current latest Tailwind v4.x release? The skill says "verified against
   4.3.3" — is that still current, and did anything below change after it?

Colour / tokens:
2. (HIGH) `oklch()` has no legacy comma form; `oklch(0.7 0.1 250, 0.5)` passes through the
   Tailwind build untouched with no warning, and the browser drops the declaration at parse time.
3. (HIGH) A bare-channel token (`--background: 0 0% 100%`) is completely dead in v4 — every use
   of the token, not just `/opacity` forms.
4. `hsl(var(--background))` is a complete colour, works with `/opacity`, compiles to
   `color-mix(in oklab, hsl(var(--background)) 30%, transparent)`, and is shadcn's own prescribed
   v4 shape.
5. (HIGH) `@theme inline` vs plain `@theme`: `inline` makes the utility emit `var(--background)`
   rather than `var(--color-background)`, and without it a `.dark` override can be ignored
   because resolution follows the parent scope. Is this an accurate description of the mechanism?
6. shadcn's current default theme still ships `--border: oklch(1 0 0 / 10%)` and
   `--input: oklch(1 0 0 / 15%)` in `.dark`. Also: is the radius ladder still
   `sm .6 / md .8 / lg 1 / xl 1.4` times `--radius`, and is `--radius` still `0.625rem`?
7. Is the shadcn token role list in `setup.md` complete and current? Check for roles the skill
   omits — `chart-1..5`, `sidebar-*`, and whether `--destructive-foreground` is still absent.

Utilities / syntax:
8. (HIGH) The spacing scale is unbounded — every integer works, compiling to
   `calc(var(--spacing) * N)`; `p-18`, `mt-21`, `w-101` are all real. Also open-ended `z-N`,
   `grid-cols-N`.
9. (HIGH) v4 `ring` is 1px (so remapping `ring` to `ring-3` triples it); `rounded` is a hardcoded
   0.25rem while `rounded-sm` is `var(--radius-sm)`.
10. (HIGH) `shadow-sm`, `blur-sm`, `rounded-sm`, `drop-shadow-sm`, `backdrop-blur-sm` all still
    exist as their own v4 utilities and were NOT deleted by the v3-to-v4 rename. The smallest v4
    shadow is `shadow-2xs`.
11. (HIGH) When two utilities set the same property, the winner is decided by Tailwind's
    **emission order**, not markup order. The skill claims, verified in 4.3.3: `.w-32` is emitted
    before `.w-full` so `w-full` wins; `.text-lg` before `.text-sm` so `text-sm` wins. Verify —
    this is the single most falsifiable claim in the skill and the most damaging if wrong.
12. `!flex` (v3 prefix) still parses in v4; `flex!` is the canonical suffix form.
13. `bg-(--token)` is the canonical short form of `bg-[var(--token)]`, including on modifiers
    (`bg-primary/(--alpha)`).
14. `*:` / `**:` are the first-class forms of `[&>*]:` / `[&_*]:`; `*:[[role=checkbox]]:`,
    `*:data-open:`, `has-[...]:`, `not-first:`, `odd:`, `in-*` all exist as described.
15. `[&:hover]:` is NOT equivalent to `hover:` because the named variant also wraps
    `@media (hover: hover)`. Verify this is still true in current v4.
16. The v3-to-v4 rename table row: `bg-gradient-to-r` to `bg-linear-to-r`, `flex-grow` to `grow`,
    `overflow-ellipsis` to `text-ellipsis`, `break-words` to `wrap-break-word`,
    `decoration-clone` to `box-decoration-clone`, `bg-left-top` to `bg-top-left`.

Directives / build:
17. (HIGH) `@layer utilities { .x {} }` emits the class but does NOT register a utility, so
    `hover:x` / `lg:x` do not exist; `@utility x {}` is the correct form.
18. (HIGH) `@custom-variant` is the current directive for defining a variant; `@variant` applies
    an already-registered variant inside CSS; defining with `@variant name (selector)` is v4-beta
    syntax that is still silently accepted. Verify all three parts.
19. `@tailwindcss/postcss` is the only PostCSS plugin needed and `postcss-import` + `autoprefixer`
    must be removed. On Vite use `@tailwindcss/vite`.
20. Lightning CSS prefixing targets Chrome 111 / Safari 16.4 / Firefox 128 and ignores
    `browserslist`. Are those the current numbers?
21. `tailwind.config.js` is not auto-detected in v4; `@config` loads it but `corePlugins`,
    `safelist` and `separator` are ignored from there; safelisting moved to `@source inline(...)`.
    Verify the `@source inline("{hover:,}bg-{red,blue,amber}-{50,{100..900..100},950}")` brace-
    expansion syntax is correct.
22. `@apply` in Vue/Svelte/Astro `<style>` or a CSS Module needs `@reference`. The claim that
    `@reference` was pathological before 4.1.6 and that PR #17836 fixed the per-`@reference`
    rescan — check the PR number and the version.
23. `--spacing(6)` is a build-time function that hard-errors in an unprocessed block, and
    `calc(var(--spacing) * 6)` is the runtime equivalent because the main stylesheet emits
    `--spacing` into `:root`.
24. A v3 entry file (`@tailwind base/components/utilities`) does NOT error in v4 — only
    `@tailwind utilities` is honoured, so the build succeeds with no Preflight and no theme vars.
    Verify this is still the behaviour and not now a hard error.
25. `@import "tailwindcss" important;` is the current way to force all utilities important.

Layout / gotchas:
26. `truncate` on a flex/grid item needs `min-w-0` because `min-width: auto` prevents shrinking.
27. `md:` = `@media (width >= 48rem)`; `@md:` = `@container (width >= 28rem)`. Confirm both
    numbers and that `@container` sets `container-type: inline-size`.
28. Dynamic class names (`bg-${x}-500`) are never generated — the scanner reads source as plain
    text.

Tooling:
29. (HIGH) `eslint-plugin-better-tailwindcss` — does the rule `enforce-canonical-classes` exist
    under that exact name today? Confirm the options `entryPoint` (a `settings` key),
    `rootFontSize`, `collapse`, `logical`, their defaults, and that it wraps Tailwind's
    `canonicalizeCandidates` API. Confirm the `enforce-shorthand-classes` conflict is real.
    Check whether the plugin has renamed or deprecated anything recently.
30. Is `rootFontSize`'s default really `undefined` (not 16)? The skill says the plugin's own docs
    contradict themselves and the options table is right.
31. Biome's `useSortedClasses` — still in `nursery`? Still `unsafe` fix? Still unable to see
    custom utilities/variants?
32. `prettier-plugin-tailwindcss` v4 needs `tailwindStylesheet`.
33. `tailwindCSS.classFunctions` is a real VS Code Tailwind IntelliSense setting.
34. `cnfast` — does it exist, what is its current version, and is the "byte-identical output,
    ~3.8x faster, ~1 KB more gzipped" claim traceable to the vendor? Flag if it looks abandoned.
35. (HIGH) v4 Preflight sets `cursor: default` on buttons; shadcn's `buttonVariants` still ships
    NO `cursor-pointer`; `npx shadcn init --pointer` is a real flag that writes a base rule.
    Verify all three — the `--pointer` flag especially.
36. `--popover`/`--popover-foreground` are consumed by Popover, Dialog, DropdownMenu, Select,
    Command and Tooltip; `--radius-xl` is consumed by Card. Verify against current shadcn source.

## Task 3 — Container queries (expand this)

The skill currently treats container queries defensively — one gotcha explaining `@md:` is not
`md:`, and a "don't convert viewport variants into container queries" rule. I want to know
whether the house style should **lean into them more**, and if so what the guidance should be.

Start from these two articles, then go wider with Exa:
- https://eastondev.com/blog/en/posts/dev/tailwind-responsive-layout-container-queries/
- https://richdynamix.com/articles/tailwind-v4-container-queries-component-responsive

Answer specifically:
- Are container queries built into v4 core now (no `@tailwindcss/container-queries` plugin)?
- Current browser support / baseline status. Any real-world reason to hold back?
- What is the actual decision rule for "container query vs viewport breakpoint"? I want a
  crisp heuristic an agent can apply, not "it depends."
- Named containers (`@container/main`, `@lg/main:`), `@max-*`, container query **units**
  (`cqw`, `cqi`, ...) — which of these are worth teaching, and what is the syntax in v4?
- Known traps: does `container-type: inline-size` break anything (sticky positioning, height
  collapse, `overflow`)? Does it affect the element itself vs only descendants? Perf cost?
- How does this interact with a shadcn component library — do shadcn components already use
  `@container`? (Check `sidebar`, `card`, the `container` in blocks.)
- Concretely: **what should change in the skill?** Propose exact replacement/added prose, in the
  skill's existing voice (terse, imperative, reason-before-rule, no filler). Say which file each
  block belongs in. If the honest answer is "the current defensive framing is right, change
  nothing," say that instead — do not invent work.

## Task 4 — Salvage assessment for a UI-mistakes log

Read `C:\Users\Ahmed Ibrahim\Desktop\UI Collisions\ui-collisions-log.md` (8 entries, C1-C8, from
restyling a shadcn/Base-UI app).

Most of it is shadcn-sidebar-specific and belongs in a separate `ui-collisions` skill, NOT here.
**Do not force a fit.** For each entry, say KEEP / DROP and why, judged against this skill's
scope (Tailwind v4 syntax + the shadcn semantic-token house style + the cleanup pass).

My prior, which you should challenge:
- C5 (recoloured the wrong token — read the variant classes before recolouring) -> likely KEEP
- C4 (a token change ripples system-wide; passive chips want muted/tinted, not brand fill) -> likely KEEP
- C7 (compound `data-active:hover:` outranks plain `hover:` on specificity) -> likely KEEP,
  **but verify the CSS specificity claim is actually correct** and that Tailwind's variant
  stacking produces the selector the entry claims
- C6 (rank interactive states: hover lighter than active) -> borderline, design guidance
- C1, C2, C3, C8 -> likely DROP, shadcn/sidebar-specific

For anything you mark KEEP, draft the exact line(s) to add and name the target file.

---

## Output — write exactly these four files, nothing else

- `research/01-skill-best-practices.md`
- `research/02-claim-audit.md`  (table: Claim | Verdict | Note | Source URL)
- `research/03-container-queries.md`
- `research/04-ui-collisions-salvage.md`

Rules for the reports:
- Every verdict needs a source URL. No URL = mark it UNVERIFIED.
- Lead each file with the items that would change the skill. Bury the confirmations.
- If a claim is WRONG, quote the exact line from the skill file and give the corrected wording.
- Do not soften. If something in this skill is wrong, say it plainly.
- Do not edit anything under `tailwind/`.
