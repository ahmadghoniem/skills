# Provenance table — claims as the skill states them now

Wording is taken from `tailwind/SKILL.md` and `tailwind/references/*.md` after the audits, not from `02-claim-audit.md`. Line numbers are 1-based as of this consolidation.

**How verified**

- **compiled** — someone ran Tailwind (or the ESLint plugin) and read output. Prefer `05-build-verification.md`. The 2026-08-18 pass recorded in the old evaluation index is cited as “prior compile” where `05` did not repeat it (no `out.css` kept for those).
- **documented** — docs, changelog, spec, or first-party source, usually via `02-claim-audit.md` or an archive research note.
- **unverified** — stated as fact in the skill; no compile and no citation in this tree.

**Corrected** means an earlier skill sentence was WRONG/OUTDATED and the current line is the fix. Old wording is in the last column.

Sources column points at the research file to open, then the upstream URL that file used.

---

| Claim (as stated in the skill) | File:line | Verdict | How verified | Source | Corrected? |
| --- | --- | --- | --- | --- | --- |
| Hard rule: Tailwind v4 only; never emit v3 patterns (`tailwind.config.js` as default, `content`/purge, `darkMode: 'class'`, `@tailwind base/components/utilities`, `bg-opacity-*`, `@layer utilities` for custom utilities) | `tailwind/SKILL.md:14` | live | documented | `02` #19–21, 24; upgrade guide | — |
| Dark mode / colour driven by semantic CSS-variable tokens in `:root` / `.dark`, bridged with `@theme inline`; `dark:` rare | `tailwind/SKILL.md:20` | live | documented | `02` #5; https://tailwindcss.com/docs/theme | — |
| Read the project’s token names from its CSS; shadcn names are the scaffold default, not a law | `tailwind/SKILL.md:22` | live | documented | `02` #7; https://ui.shadcn.com/docs/theming | — |
| Every colour token is `oklch(L C H)` or `oklch(L C H / A)`; no hex/`rgb()`/`hsl()` in `:root`, `.dark`, or `@theme` | `tailwind/SKILL.md:28` | live | documented | `archive/research-color-rules.md`; shadcn theming | — |
| Store the complete colour function. Bare channels (`--background: 0 0% 100%`) are invalid in v4 for **every** use, not just `/opacity` | `tailwind/SKILL.md:29` | live | documented | `02` #3; https://github.com/tailwindlabs/tailwindcss/discussions/16667 | **yes** — used to say wrapped `hsl(var(--x))` also killed `/opacity` |
| `oklch()` has no comma form; `oklch(0.7 0.1 250, 0.5)` passes the 4.3.3 build with no warning; the browser drops it | `tailwind/SKILL.md:30` | live | compiled | `05` claim 2 (exit 0, value copied into theme, no `warn`); CSS Color 4 via `archive/research-color-rules.md` | — |
| Wrapped `hsl(var(--background))` is a complete colour and works; convert for house style, not because it is broken | `tailwind/SKILL.md:29` | live | documented | `02` #4 | **yes** — used to call it “shadcn’s prescribed v4 shape”; current shadcn is complete `oklch()` |
| Keep theme tokens opaque; fade on the utility. Exception: shadcn dark hairlines `--border: oklch(1 0 0 / 10%)`, `--input: … / 15%` | `tailwind/SKILL.md:31` | live | documented | `02` #6; https://ui.shadcn.com/docs/theming | **yes** — opaque rule shipped with no hairline exception (self-contradiction with scaffold) |
| Every fill token has a paired `-foreground`; contrast is a lightness gap | `tailwind/SKILL.md:32` | live | documented | `archive/research-color-rules.md` | — |
| Fix contrast by moving L; never raise C to “add contrast” | `tailwind/SKILL.md:33` | live (simplification) | documented | `archive/research-color-rules.md` Rule 1 (true at low C; C can move WCAG near threshold) | **yes** — chroma ceiling “≤ 0.22” contradicted scaffold `--destructive` C 0.245; now cites that token |
| Out-of-gamut / oversaturated: lower C, keep L and H. Ceilings vary by hue; C ≤ 0.04 grey, ≤ 0.12 comfortable accents; shadcn `--destructive` is `oklch(0.577 0.245 27.325)` | `tailwind/SKILL.md:34` | live (authoring advice) | documented | `archive/research-color-rules.md` Rule 3 (browsers often still clip) | — |
| Never compute OKLCH by hand; convert values only | `tailwind/SKILL.md:35` | live | documented | `archive/oklch-research-skill.md` (borrow conversion hygiene; reject ramp algorithms) | — |
| No brand ramp unless asked; don’t invert a ramp for dark — re-set roles under `.dark` | `tailwind/SKILL.md:36` | live | documented | `archive/oklch-research-skill.md` (rejected 50–950 / invert) | — |
| Reach for a semantic token before raw colour; `dark:` rarely needed; `bg-white dark:bg-gray-900` is a smell | `tailwind/SKILL.md:40-41` | live | documented | `04` C4/C5; shadcn token model | — |
| Map the token the class list consumes before editing `:root`; `--sidebar-primary` is not “the active item” unless markup uses it; a token is a role (changing `--primary` restyles default Badge too) | `tailwind/SKILL.md:42` | live | documented | `04` C5, C4 | — |
| Check live docs before asserting a version-specific fact | `tailwind/SKILL.md:43` | live | — | process rule, not a Tailwind fact | — |
| Radius via `rounded-md`/`rounded-lg` bound to `--radius`, not `rounded-[6px]` | `tailwind/SKILL.md:44` | live | documented | `02` #6, #9 | — |
| Spacing scale is unbounded; every integer compiles to `calc(var(--spacing) * N)`; `p-18`, `mt-21`, `w-101` are real; same for open-ended `z-N`, `grid-cols-N`. Never add `--spacing-18` | `tailwind/SKILL.md:47` | live; formula slightly stale | documented (+ prior compile) | `02` #8: from 4.3.1, `*-0` emits `0` and `*-1` emits `var(--spacing)` not `calc(… * 1)`. Unbounded integers still confirmed. Prior compile listed in old evaluation index | — |
| Colour ladder: role → semantic token; decorative one-off → nearest stock shade; promote to `@theme` if it themes or repeats; never scatter raw hex | `tailwind/SKILL.md:48-52` | live | documented | house style; `archive/research-canonical-classes.md` for hex→token pressure | — |
| Value that repeats (>1 place): promote to `@theme` | `tailwind/SKILL.md:53` | live | documented | cited as Tailwind maintainer guidance; URL not copied into `02` | — |
| `-px` utilities are intentional; rewrite `p-[1px]` → `p-px`; on-scale brackets → scale step | `tailwind/SKILL.md:55` | live | documented | `archive/research-canonical-classes.md` (px→scale needs `rem`) | — |
| Custom utility is `@utility`, not `@layer utilities { .name {} }` (class emits but is never registered, so `hover:name` / `lg:name` missing) | `tailwind/SKILL.md:57` | live | documented | `02` #17; `archive/research-utility-directive.md`; https://github.com/tailwindlabs/tailwindcss/issues/14058 | — |
| Custom variant is `@custom-variant`. `@variant` applies an existing variant. `@variant name (selector)` is v4-beta, still silently accepted | `tailwind/SKILL.md:58` | live | documented | `02` #18; PR #15663; `archive/findings-cursor-index.md` | — |
| `*:` / `**:` not `[&>*]:` / `[&_*]:`; `*:[[role=checkbox]]:`; `*:data-open:`; `has-[…]`, `not-first:`, `odd:` | `tailwind/SKILL.md:66-70` | live | documented + prior compile | `02` #14; old evaluation index compile list | — |
| `group-[.foo]:` only rewrite when a named state variant exists | `tailwind/SKILL.md:70` | live | prior compile | old evaluation index: `group-[]:` generates nothing; `peer-[&]:` ≡ `peer:` | **yes** — shipped a `group-[]:` → `in-[.group]:` row |
| `flex!` not `!flex`; prefix still parses (non-canonical, not broken) | `tailwind/SKILL.md:72` | live | documented + prior compile | `02` #12 | — |
| `bg-(--token)` not `bg-[--token]` / `bg-[var(--token)]`; modifiers `bg-primary/(--alpha)` | `tailwind/SKILL.md:73` | live | documented + prior compile | `02` #13; old evaluation index: `bg-[--token]` emits `background-color: --token` (broken) | — |
| `grid-cols-[auto_1fr]` (underscore = space) | `tailwind/SKILL.md:74` | live | documented + prior compile | `archive/research-canonical-classes.md` | — |
| v3→v4 names: `bg-linear-to-r`, `grow`, `text-ellipsis`, `wrap-break-word`, `box-decoration-clone`, `bg-top-left` | `tailwind/SKILL.md:75` | live | documented + prior compile | `02` #16 | — |
| shadcn/tailwind.css ships broader `data-open` / `data-closed` / … matching `[data-state="open"]` *and* `[data-open]` | `tailwind/SKILL.md:77` | live | compiled (file dump) | `05` bonus + appendix (`shadcn@4.18.0`) | — |
| Collapse same-value sides: `size-4`, `p-4`, `inset-0`, `text-sm/7` | `tailwind/SKILL.md:81` | live | documented | `archive/research-canonical-classes.md` collapse table | — |
| Don’t restate defaults (`flex flex-row` → `flex`, `opacity-100`, …) | `tailwind/SKILL.md:82` | live | documented | CSS defaults / plugin collapse; not separately compiled | — |
| Don’t emit two classes that set the same property; markup order does not win — Tailwind emission order does | `tailwind/SKILL.md:83` | live | compiled | `05` claim 11; `02` #11 | **yes** — auto-apply used to keep `w-32` over `w-full` |
| Verified in 4.3.3: `.w-32` before `.w-full` so **`w-full` wins**; `.text-lg` before `.text-sm` so **`text-sm` wins**; `p-4` beats `p-2` because spacing sorts ascending. Opposite markup → byte-identical CSS. `text-sm`/`text-lg` both set `font-size` + `line-height`; later class wins both | `tailwind/references/cleanup.md:27` | live | compiled | `05` claim 11 | **yes** — `02` had left the font-size pair UNVERIFIED |
| `[&:hover]:` ≠ `hover:` — named variant wraps `@media (hover: hover)` | `tailwind/SKILL.md:87` | live | documented + prior compile | `02` #15 | — |
| Never run the v3→v4 rename table on v4 code. `ring` is 1px so `ring-3` triples it; `rounded` is hardcoded 0.25rem, `rounded-sm` is `var(--radius-sm)` | `tailwind/SKILL.md:88` | live | documented + prior compile | `02` #9; upgrade guide; old evaluation index (`ring` ≡ `ring-1`, `shadow` ≡ `shadow-sm`) | — |
| Never rewrite `shadow-sm` / `blur-sm` / `rounded-sm` / `drop-shadow-sm` / `backdrop-blur-sm` to `-xs`. Smallest v4 shadow is `shadow-2xs` | `tailwind/SKILL.md:90` | live | documented + prior compile | `02` #10; `archive/candidate-12rules.md` Rule 9 is the negative example | — |
| Don’t convert viewport `md:`/`lg:` into `@md:`/`@lg:`. Viewport default for page chrome; `@container` when a component lives in more than one slot width | `tailwind/SKILL.md:90` | live | documented | `02` #27; `03-container-queries.md` (folded into gotchas) | — |
| `md:` = `@media (width >= 48rem)`; `@md:` = `@container (width >= 28rem)`; `@container` → `container-type: inline-size`; plugin `@tailwindcss/container-queries` is gone | `tailwind/references/gotchas.md:53-55` | live | documented | `02` #27; `03` | — |
| Named `@container/main` + `@lg/main:`; `@max-md:` vs `max-md:`; descendants query the container, the marked node does not query itself | `tailwind/references/gotchas.md:59-67` | live | documented | `03`; https://tailwindcss.com/docs/responsive-design | — |
| `container-type` can interact badly with percentage heights and sticky descendants — verify in the browser | `tailwind/references/gotchas.md:69` | live (soft) | documented | `03` (no first-party Tailwind perf cliff; CSS containment) | — |
| Stacked `data-active:hover:` keeps selected style on hover. A **library** `:where()` variant (shadcn) is (0,1,0) so `hover:` at (0,2,0) always wins; stock `data-active:` is (0,2,0) and is emitted later so **active wins** | `tailwind/SKILL.md:91`; `tailwind/references/cleanup.md:28-32` | live in skill | **unverified** in this tree | Skill says “Compiled on 4.3.3”. **Not in `05`.** `04` said stock `hover:` and `data-active:` tie at (0,2,0) and source order decides — **different mechanism**. shadcn `:where()` wrappers are in the `05` appendix | — |
| Keep `data-[foo=bar]:`, `aria-[selected]:`; `in-*` is descendant not child | `tailwind/SKILL.md:92-93` | live | documented | `02` #14 (`in-[…]` → `:where(...) &`) | — |
| `@theme inline` makes the utility emit `var(--background)` not `var(--color-background)`; without it `.dark` can be ignored (parent-scope resolution) | `tailwind/references/setup.md:74-75` | live | documented | `02` #5; PR #14095 | — |
| Every role needs bridge + `:root` + `.dark`. Current shadcn also ships `chart-1…5`, full `sidebar-*`, `--radius-2xl/3xl/4xl` — bridge when the project uses them | `tailwind/references/setup.md:71` | live | documented | `02` #6–7 (scaffold snippet still omits those bridges; prose now mentions them). `--destructive-foreground` still absent | — |
| `--popover` / `--popover-foreground` used by Popover, Dialog, DropdownMenu, Select, Command, Tooltip — omit → silent no-style or `@apply` hard error | `tailwind/references/setup.md:73` | live; consumer list **partial** | documented (partial) | `02` #36: official table names Popover, DropdownMenu, ContextMenu; Select source confirmed; Dialog/Command/Tooltip **not** on the official list | — |
| `--radius-xl` used by Card; without it `rounded-xl` silently falls back to stock 0.75rem | `tailwind/references/setup.md:73` | Card uses `rounded-xl`: documented. Fallback 0.75rem: **unverified** | documented / unverified | `02` #36; prior compile of scaffold `rounded-xl` → `calc(var(--radius) * 1.4)` (old evaluation index) — that is the *with-token* case | — |
| Radius ladder `sm .6 / md .8 / lg 1 / xl 1.4`; `--radius: 0.625rem`; dark hairlines as above | `tailwind/references/setup.md:44-51, 77` | live | documented | `02` #6 | — |
| PostCSS plugin is only `@tailwindcss/postcss`; remove `postcss-import` + `autoprefixer`. Vite: `@tailwindcss/vite` | `tailwind/references/setup.md:81-88` | live | documented | `02` #19 | — |
| Lightning CSS prefixing: Chrome 111 / Safari 16.4 / Firefox 128; ignores `browserslist` | `tailwind/references/setup.md:90` | live | documented | `02` #20 | — |
| `tailwind.config.js` not auto-detected; `@config` loads it; `corePlugins` / `safelist` / `separator` ignored; safelist → `@source inline(...)` | `tailwind/references/setup.md:100-106` | live | documented | `02` #21 | — |
| Brace expansion `@source inline("{hover:,}bg-{red,blue,amber}-{50,{100..900..100},950}")` is valid | `tailwind/references/gotchas.md:82` | live | documented + prior compile | `02` #21; old evaluation index | — |
| `next-themes` `ThemeProvider attribute="class"` toggles `.dark` on `<html>`, which `@custom-variant dark (&:is(.dark *))` keys off | `tailwind/references/setup.md:111-118` | live | **unverified** as a trio | Dark selector itself: documented (`02` / shadcn). next-themes wiring not audited in research files | — |
| Hand-written `@custom-variant dark` is still required; `shadcn/tailwind.css` does **not** define `dark` | (scaffold `setup.md:23`; implied vs current shadcn default CSS) | live | compiled (file dump) | `05` bonus | — |
| Leave `dark:` in vendored shadcn primitives (per-theme opacity). App-code `bg-input/(--alpha-fill)` with a flipping `--alpha-fill` | `tailwind/references/setup.md:120-132` | live (policy) | documented (modifier form) | `02` #13 for `/(--alpha)`; policy not separately sourced | — |
| `cnfast`: byte-identical across 113k call groups; ~3.8× vendor bench; ~1 KB more gzip; v0.1.0 — treat speed as unvalidated | `tailwind/references/setup.md:145` | live | documented | `02` #34 | — |
| v4 Preflight `cursor: default` on buttons; shadcn `buttonVariants` has no `cursor-pointer`; `npx shadcn init --pointer` is real | `tailwind/references/setup.md:149` | live | documented | `02` #35 | — |
| `@apply` / `theme()` in Vue/Svelte/Astro `<style>` or CSS Modules need `@reference`. Pathological before 4.1.6; PR #17836 stopped the per-`@reference` rescan | `tailwind/references/gotchas.md:21-23` | live | documented | `02` #22 | **yes** — used to say `@reference` OOMs at scale with no version bound |
| In an unprocessed block prefer `var(--primary)` and `calc(var(--spacing) * 6)`, not `--color-primary` or `--spacing(6)` | `tailwind/references/gotchas.md:31-34` | live | compiled | `05` claim 23 | **yes** — used to offer `--spacing(6)` as the escape |
| `--spacing(6)` hard-errors without the theme variable. Verbatim 4.3.3: `The --spacing(…) function requires that the \`--spacing\` theme variable exists, but it was not found.` Resolves under `@reference` to `calc(var(--spacing, 0.25rem) * 6)` | `tailwind/references/gotchas.md:34` | live | compiled | `05` claim 23 (**CHANGED** vs older shorter quote) | **yes** — quote now matches CLI |
| Bare-channel compiled shapes: `.bg-background { background-color: var(--background); }`; `/30` uses `color-mix(in oklab, …)` | `tailwind/references/gotchas.md:40-42` | live | documented | `02` #3–4 | **yes** — `/opacity` was described as the only failure |
| `group-hover:*` needs `group`; `peer-focus:*` needs `peer` on a **preceding** sibling; `@sm:`/`@md:` need `@container` ancestor or the query never matches | `tailwind/references/gotchas.md:47-51` | live | documented (`@container` silent miss: `03`) | marker-class half: **unverified** in research files (standard Tailwind) | — |
| `h-screen` ignores mobile browser chrome; use `h-dvh` | `tailwind/references/gotchas.md:71-73` | live | **unverified** | no research file cites `dvh` / mobile chrome | — |
| Dynamic `bg-${color}-500` never generated; scanner is plain text | `tailwind/references/gotchas.md:75-76` | live | documented | `02` #28 | — |
| `truncate` on a flex/grid **item** needs `min-w-0` (`min-width: auto`) | `tailwind/references/gotchas.md:87-89` | live | documented | `02` #26 | — |
| `line-clamp-*` clamps lines, requires wrap, never wants a width constraint or `whitespace-nowrap` | `tailwind/references/gotchas.md:91` | live | **unverified** | not in `02` or `05` | — |
| `@import "tailwindcss" important;` forces all utilities important | `tailwind/references/gotchas.md:104` | live | documented | `02` #25 | — |
| v3 `@tailwind` trio does **not** error (exit 0). `base`/`components` emit nothing; `utilities` runs with no theme/Preflight. On `flex p-4 bg-red-500`, output is only `.flex { display: flex }` — **the tell is `flex` working while `p-4` does nothing** | `tailwind/references/gotchas.md:107-115` | live | compiled | `05` claim 24 | **yes** — used to say “emits utilities, every `bg-background` token dead”; `02` had UNVERIFIED / possible hard error |
| Mobile-first: unprefixed everywhere; `md:` is md and up; `sm:hidden md:block` = hidden on small, shown md+ | `tailwind/references/gotchas.md:117-119` | live | **unverified** | not in numbered audit | — |
| `tailwindCSS.classFunctions` is a real VS Code setting (regex on function name) | `tailwind/references/editor.md:16-23` | live | documented | `02` #33 | — |
| `enforce-canonical-classes` exists; wraps `canonicalizeCandidates`; `entryPoint` is a **settings** key; without it the rule lints stock Tailwind | `tailwind/references/editor.md:41-61` | live | documented | `02` #29; `archive/research-canonical-classes.md` | — |
| `rootFontSize` default is `undefined` (docs table beats prose). Without it `p-[16px]` / `translate-y-[2px]` produce **zero** warnings; with it they rewrite | `tailwind/references/editor.md:63` | live | documented + prior empirical lint | `02` #30; old evaluation index | — |
| With `collapse: true`, also turn off `enforce-shorthand-classes`, `enforce-consistent-important-position`, `enforce-consistent-variable-syntax` | `tailwind/references/editor.md:67` | live | documented | `02` extra + plugin docs | **yes** — skill used to mention only shorthand |
| Never `@tailwindcss/upgrade` for canonicalisation on v4 — rewrites CSS, no templates-only mode, px→scale needs `rem` which the CLI does not pass | `tailwind/references/editor.md:71` | live | documented | `archive/research-upgrade-codemods.md` | — |
| `prettier-plugin-tailwindcss` v4 needs `tailwindStylesheet` | `tailwind/references/editor.md:75` | live | documented | `02` #32 | — |
| Biome `useSortedClasses` still nursery; autofix **unsafe** (will not run under ordinary safe fix); cannot see `@theme` / custom utilities / variants | `tailwind/references/editor.md:77` | live; custom-utility blindness weaker | documented (nursery + unsafe) | `02` #31 — custom `@utility` blindness **UNVERIFIED** there | **yes** — used to recommend `"fix": "safe"` |
| If class list goes through `cn()` / tailwind-merge, last-in-string wins because the merger drops the loser | `tailwind/references/cleanup.md:34` | live | documented | `02` #11 (cn / tailwind-merge) | — |
| `hsl(var(--x))` is not a defect; leftover v3/early-v4, not what shadcn ships today | `tailwind/references/cleanup.md:46` | live | documented | `02` #4 | **yes** — “prescribed v4 shape” |
| `size-*` preferred over `w-N h-N` | `tailwind/references/cleanup.md:18` | live | documented | shipped v3.4 (`archive/findings-cursor-index.md`); not a v4 invention — skill no longer claims “native in v4” | **yes** — dropped “native in v4” |
| `@apply` does **not** lose variants | (absent — correctly omitted) | n/a | documented | old evaluation ledger: v1 limitation, fixed in v2 | **yes** — claim removed |

---

## Claims that had no evidence — all now closed

This list was the point of the cleanup. Every row is settled; four were settled *against* the
skill's wording, which is why the skill changed.

| # | Claim | Closed by | Outcome |
| --- | --- | --- | --- |
| 1 | `h-screen` ignores mobile chrome; use `h-dvh` | `08` §1 | **CONFIRMED** — `100vh` / `100dvh` compiled; the chrome behaviour itself is spec/MDN. `h-svh` / `h-lvh` also exist; the skill deliberately mentions neither. |
| 2 | Stock vs shadcn `:where()` `data-active:` specificity | `06` | **CONFIRMED with a corrected mechanism.** Stock ties at (0,2,0) and `data-active:` wins on emission order — *no bug*. shadcn's `:where()` wrapper drops it to (0,1,0), so `hover:` wins regardless of order. Supersedes `04`'s C7. |
| 3 | `line-clamp-*` never wants a width constraint or `whitespace-nowrap` | `08` §2 | **OVERSTATED** — `nowrap`/`truncate` do defeat clamp; a width constraint is fine and is what sets the wrap width. Skill reworded. |
| 4 | `next-themes` `attribute="class"` is what the dark variant keys off | `08` §3 | **CONFIRMED** on 0.4.6 by source read; API unchanged, default is still `data-theme`. |
| 5 | Without `--radius-xl`, `rounded-xl` falls back to stock `0.75rem` | `07` §1 | **CONFIRMED** — `@theme inline` extends rather than replaces; unbridged rungs keep stock values, exit 0, no warning. |
| 6 | Omitted `--popover`: silent in markup, fatal under `@apply` | `07` §2–3 | **CONFIRMED** — utility simply not emitted (not emitted broken); `@apply` exits 1 with the exact quoted message. |
| 7 | Mobile-first reading of `sm:hidden md:block` | `08` §4 | **OVERSTATED** — element is *visible* below `sm`. Skill now walks three widths. |
| 8 | Dialog, Command, Tooltip consume `--popover` | `08` §5 | **WRONG** for Dialog and Tooltip (they use `bg-background` / `bg-foreground`). Command correct. Skill rewritten and five omitted consumers added. |
| 9 | Biome cannot see `@theme` / custom utilities | `08` §6 | **CONFIRMED** on 2.5.9 — and then **moot**: Biome was removed from the skill entirely. |
| 10 | Container units `cqi`/`cqw` vs `cqh`/`cqb` | `10` | **CONFIRMED** — all pass through as arbitrary values with exit 0; block-axis units silently resolve against the small viewport under `container-type: inline-size`. |

## Still soft (evidence exists but disagrees or is stale)

- **Spacing formula** `calc(var(--spacing) * N)` for *every* integer — `02` #8 says 4.3.1
  special-cases 0 and 1. Skill still states the universal `calc` formula (`SKILL.md:47`).
- **`group` / `peer` marker classes** — standard, but this tree never verified them
  (`gotchas.md:47-49`).
