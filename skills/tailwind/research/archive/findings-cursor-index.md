> **Archive pointer.** Evaluation of [candidate-hairyf-index.md](candidate-hairyf-index.md). Not a duplicate of [findings-cursor-copy.md](findings-cursor-copy.md). Index: [README.md](README.md).

# Candidate index vs our Tailwind v4 skill

Sources fetched 2026-08-18. **VERIFIED** = official docs or first-party source (URL). **INFERRED** = follows from those without a dedicated quote.

Candidate: [hairyf/skills `skills/tailwindcss`](https://github.com/hairyf/skills) (self-described v4.1.18, generated 2026-01-28). Local copy: `tailwind/tailwindcss.md`. Linked refs read from GitHub `HEAD`.

---

## 1. Architecture verdict

The candidate is a generated docs mirror: always-on `SKILL.md` is a TOC into ~35 files that restate tailwindcss.com. Ours is house style plus anti-patterns, and it deliberately does not clone the docs.

For an always-on coding agent, house style wins. The model already knows utility catalogs, and it can fetch [tailwindcss.com/docs](https://tailwindcss.com/docs). An index of Width / Padding / Flexbox does not change what it emits; it burns context and sends the agent to a **stale snapshot** (the gradient ref still teaches `bg-gradient-to-r`) instead of live docs. The always-visible Upgrade Guide pointer is worse: v3→v4 rename tables (`shadow` → `shadow-sm`, `ring` → `ring-3`) will get applied to code that is already v4.

The case for a hybrid is narrow. A docs index helps only when the model does not know a **name** exists (`@md:`, `starting:`, `wrap-break-word`). That is a fetch-the-docs problem, not an always-on catalog problem. What is worth adopting is two or three anti-confusion one-liners for v4 names the model still mixes up — not 35 files.

**Verdict:** do not ingest the index. Salvage the `@custom-variant` vs `@variant` distinction (their INDEX got this right) and the `@md:` / `md:` mix-up. Leave the rest.

---

## 2. Gaps worth adding

Ranked. Each is an area agents demonstrably get v4 wrong. Drop-in prose is ready to paste.

### 1. `@custom-variant` defines; `@variant` applies — **VERIFIED**

Agents trained on the v4 **beta** docs still register variants with `@variant name (selector)`. That directive now only applies an existing variant inside CSS. Current docs: [`@custom-variant`](https://tailwindcss.com/docs/functions-and-directives) / [`@variant`](https://tailwindcss.com/docs/adding-custom-styles). Beta-era counterexample: [v3.tailwindcss.com/docs/v4-beta](https://v3.tailwindcss.com/docs/v4-beta) (`@variant pointer-coarse (...)`). Our `setup.md` already *uses* `@custom-variant` for `dark` and never warns against the beta form.

**File:** `tailwind/SKILL.md` → Authoring rules (one bullet).

```
- **Registering a variant is `@custom-variant`, not `@variant`.** `@custom-variant theme-midnight (&:where([data-theme="midnight"] *));` adds `theme-midnight:`. `@variant` only applies an already-registered variant inside CSS (`.x { @variant dark { … } }`). Never `@variant name (selector)` to define one — that was v4-beta syntax.
```

### 2. `@md:` is not `md:` — **VERIFIED**

[`@container` / `@md:`](https://tailwindcss.com/docs/responsive-design) is a container query (`@md` = 28rem / 448px container). `md:` is a viewport breakpoint (48rem / 768px). Agents emit `@md:flex-row` with no `@container` ancestor, or swap them. Our skill never mentions container queries.

**File:** `tailwind/references/gotchas.md` (new section). Add a trigger in `SKILL.md` → When to load more: “container queries / `@md:` vs `md:`”.

```
## `@md:` is a container query, not a breakpoint

`md:` is viewport (`@media (width >= 48rem)`). `@md:` is a container query (`@container`, 28rem) and does nothing without `@container` on an ancestor. Do not substitute one for the other. Unprefixed still means “mobile / small container”; `@md:` is that size **and up**.
```

### 3. Dynamic `--spacing` — don’t invent `--spacing-18` — **VERIFIED**

v4 spacing utilities are `calc(var(--spacing) * N)` from a single `--spacing` (default `0.25rem`). `p-18` already exists; you do not declare `--spacing-18`. **VERIFIED:** [v4.0 blog, “Dynamic utility values”](https://tailwindcss.com/blog/tailwindcss-v4). Agents still add named spacing keys or `p-[4.5rem]` for integer steps. Our ladder says “4px grid / `p-4`=16px” and never states the scale is open-ended.

**File:** `tailwind/SKILL.md` → arbitrary-value ladder, step 1 (after the 4px grid sentence).

```
v4 spacing is a multiplier of `--spacing` (0.25rem). Integer steps already exist (`p-18` = 4.5rem). Do not add `--spacing-18` to `@theme`, and do not write `p-[4.5rem]` for a whole step. Named `--spacing-*` keys are only for non-numeric names (`--spacing-gutter`).
```

---

## 3. Gaps deliberately rejected

- **starting:** — real API ([docs](https://tailwindcss.com/docs/hover-focus-and-other-states)); limited support; not a house-style mistake. Fetch docs when animating first paint.
- **@source / content detection** — we already ban `content: []` and document `@source inline()` for dynamic classes. shadcn copies components in-tree; `@source` for `node_modules` is a rare scaffolding gotcha, not always-on.
- **subgrid** — `grid-cols-subgrid` is CSS knowledge; canonicalize even maps `grid-cols-[subgrid]` → `grid-cols-subgrid`.
- **field-sizing** — new utility, not a v3-wrongness. Docs suffice.
- **text-wrap / wrap-break-word** — already in our rename table (`break-words` → `wrap-break-word`). **VERIFIED:** [overflow-wrap](https://tailwindcss.com/docs/overflow-wrap).
- **3D transforms** (`rotate-x-*`, `transform-3d`) — first-class ([rotate](https://tailwindcss.com/docs/rotate), [transform-style](https://tailwindcss.com/docs/transform-style)); rare in this shadcn house style. Arbitrary ladder already covers genuine `transform-[…]` one-offs.
- **@custom-variant tutorial** — usage is already in `setup.md`; only the beta-name trap (gap 1) is worth adding.
- **color-mix / opacity modifier** — already the core of our OKLCH / complete-colour rules.
- **not-*** — pattern already in the table (`not-first:`). No extra section.
- **inert / nth-*** — first-class ([states](https://tailwindcss.com/docs/hover-focus-and-other-states)); table already has `odd:`. Agents don’t need house style here.
- **Utility catalog (display, flex, width, margin, …)** — weights + live docs.
- **Always-on Upgrade Guide / rename mappings** — actively harmful on v4. We already warn in `editor.md`.
- **Preflight / dark-mode tutorials** — we already own those as house style.
- **Installing the 35-file index “for progressive disclosure”** — SKILL.md TOC is always in context; the refs are a stale docs fork.

---

## 4. Candidate errors

### INDEX / Key Recommendations (the always-on file)

| Claim | Verdict | Citation |
| --- | --- | --- |
| Prefer `@theme`, `@utility`, and **`@custom-variant`** over JS configs | **Correct.** Not the beta `@variant`-to-define trap. | [Functions and directives](https://tailwindcss.com/docs/functions-and-directives) |
| Other 5 bullets (utilities in markup, `@theme` tokens, mobile-first, complete class names, stack variants) | **Correct, generic.** We already cover class interpolation. | [Detecting classes](https://tailwindcss.com/docs/detecting-classes-in-source-files), [Responsive design](https://tailwindcss.com/docs/responsive-design) |
| Columns: “magazine-style **or masonry** layouts” | **Wrong.** `columns-*` is CSS multi-column (newspaper flow), not Grid masonry. Official page never says masonry. | [columns](https://tailwindcss.com/docs/columns); candidate `layout-columns.md` repeats “masonry-like” |
| Transform Base: “utilities for **enabling** transforms” | **Stale / v3-flavored.** v4 transform utilities apply directly (`rotate`, `scale`, `translate` properties). No enabling `transform` class. Linked ref is better (“automatically enable”) than the INDEX blurb. | [v4.0 blog, 3D transforms](https://tailwindcss.com/blog/tailwindcss-v4); candidate `transform-base.md` |
| Upgrade Guide topic: “breaking changes, **rename mappings**” with no v3-only guard | **Risk, not a syntax error.** Linked table is right for v3→v4 and wrong if applied to v4 (`shadow` → `shadow-sm`, `rounded` → `rounded-sm`, `ring` → `ring-3`, `outline-none` → `outline-hidden`). Our skill exists to stop that. Candidate INDEX never says “only when migrating from v3”. | [Upgrade guide, Renamed utilities](https://tailwindcss.com/docs/upgrade-guide); candidate `features-upgrade.md` |

### Linked refs (generated 2026-01-28, still wrong on `HEAD`)

| File | Error | Citation |
| --- | --- | --- |
| `visual-background.md` | Teaches `bg-gradient-to-r` / `bg-gradient-to-br`. v4 canonical is `bg-linear-to-*`. Core `canonicalizeCandidates` rewrites this (`bgGradientToLinear`). | [Upgrade-era rename + engine](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/canonicalize-candidates.ts); our `research-canonical-classes.md` |
| `features-custom-styles.md` / `features-functions-directives.md` | **Correctly** split `@custom-variant` (define) vs `@variant` (apply). Salvage this distinction only. | [Adding custom styles](https://tailwindcss.com/docs/adding-custom-styles) |
| `features-upgrade.md` | Accurate as a **v3→v4** cheatsheet. Poison if loaded during v4 authoring/cleanup. | Same upgrade guide table |
| `core-theme.md` | Omits `@theme inline` (required for CSS-variable tokens that flip under `.dark`). Not false; incomplete in the exact way agents break shadcn themes. | [Theme: referencing other variables](https://tailwindcss.com/docs/theme); [Colors](https://tailwindcss.com/docs/colors) |
| `transform-base.md` | “`transform-gpu` enables hardware acceleration with `translateZ(0)`” — **INFERRED stale**; v4 2D transforms use individual CSS properties. Not verified against current compiled CSS. | Treat as suspect; do not copy |

Nothing in the INDEX claims `@variant` for **defining** custom variants. That bug lives in other skills (e.g. local `tailwind/tailwindcss - Copy.md`), not this one.

---

## 5. Bugs found in *our* skill

`@apply` “loses variants” is gone (checked). Remaining issues:

### High

**`gotchas.md`: “zero processing” snippet uses a build-time function.**

```css
background: var(--color-primary);
padding: --spacing(6);
box-shadow: var(--shadow-md);
```

`--spacing()` is a **build-time** Tailwind function; it compiles to `calc(var(--spacing) * 6)`. It is not a CSS variable and does not work in an unprocessed Vue/Svelte `<style>` / CSS Module. **VERIFIED:** [Functions and directives](https://tailwindcss.com/docs/functions-and-directives) (“Tailwind provides the following **build-time** functions”).

`var(--color-primary)` is the wrong name under our house style. We use `@theme inline { --color-primary: var(--primary) }`, so utilities (and runtime CSS) should read `var(--primary)` — the token that actually flips on `.dark`. **VERIFIED:** [Theme, `@theme inline`](https://tailwindcss.com/docs/theme); our `setup.md`.

Fix:

```css
background: var(--primary);
padding: calc(var(--spacing) * 6);
box-shadow: var(--shadow-md);
```

### Medium

**Canonical table invites `group-[]:` → `group-hover:`.** Third column: “better still, `group-hover:` / `peer-invalid:`”. Empty `group-[]` means “inside `.group`”, no state. Upgrade rewrites it to `in-[.group]:`, and leaves `peer-[]` as `peer-[&]:` — **not** `group-hover:`. Dropping the qualifier “when a named state exists” will make an agent add hover. **VERIFIED:** `research-canonical-classes.md` A.4 (upgrade `migrate-modernize-arbitrary-values` tests).

**House style vs scaffold on token alpha.** SKILL.md: “Keep theme tokens opaque. Put transparency on the utility.” `setup.md` `.dark` ships `--border: oklch(1 0 0 / 10%)` and `--input: oklch(1 0 0 / 15%)` (shadcn default). An agent following both will “fix” the scaffold or skip the rule. Pick one: either carve out shadcn’s hairline border/input tokens, or stop saying always-opaque.

### Low / stale phrasing

| Location | Issue | Citation |
| --- | --- | --- |
| `cleanup.md`: “`size-N` (native in v4)” | `size-*` shipped in **v3.4**. Exists in v4; not a v4 invention. | Tailwind 3.4 release notes (historical). Harmless if reworded to “prefer `size-*`”. |
| SKILL.md / cleanup.md: list `order-none` as the no-op default | Core canonicalize maps `order-none` → `order-0`. Removing either is a CSS no-op (`order: 0`). Teaching the deprecated name is stale. | `research-canonical-classes.md` E.5 (engine `DEPRECATION_MAP`) |
| SKILL.md: “v4 moved the important marker to the end” | Suffix is canonical (`flex!`). Prefix `!flex` still parses; core rewrites it. Don’t imply prefix is invalid. | [Styling with utility classes](https://tailwindcss.com/docs/styling-with-utility-classes); canonicalize tests |

### Checked, still good

| Claim | Verdict |
| --- | --- |
| `[&:hover]:` ≠ `hover:` because named `hover` wraps `@media (hover: hover)` | **VERIFIED.** [Upgrade guide](https://tailwindcss.com/docs/upgrade-guide) (restore with `@custom-variant hover (&:hover)`). Core canonicalize **keeps** `[&:hover]`. |
| Do not remap v4 `shadow` / `rounded` / `ring` / `outline-none` to `shadow-sm` / `rounded-sm` / `ring-3` / `outline-hidden` | **VERIFIED.** Those remaps are v3→v4 ([upgrade guide](https://tailwindcss.com/docs/upgrade-guide)). Upgrade CLI scale remaps are `isMajor(3)`-gated (`research-upgrade-codemods.md`). Applying them to v4 double-shifts. |
| Rename row: `bg-linear-to-r`, `grow`, `text-ellipsis`, `wrap-break-word`, `box-decoration-clone`, `bg-top-left` | **VERIFIED** as what to *emit*. `break-words` → `wrap-break-word` is in core `DEPRECATION_MAP`. `bg-left-top` / `decoration-clone` / `flex-grow` are upgrade/simple-legacy, not all in core canonicalize — still the right authoring names. |
| `*:` / `**:` / `*:[[role=checkbox]]:` / `bg-(--token)` / `flex!` / underscore-not-comma | **VERIFIED** (`research-canonical-classes.md` + [states](https://tailwindcss.com/docs/hover-focus-and-other-states)). |
| `/30` → `color-mix(in oklab, …)` needs a whole colour | **VERIFIED.** [`--alpha()` compiles to `color-mix(in oklab, …)`](https://tailwindcss.com/docs/functions-and-directives). |
| Preflight buttons → `cursor: default` | **VERIFIED.** [Upgrade guide, buttons](https://tailwindcss.com/docs/upgrade-guide#buttons-use-the-default-cursor); v4 `preflight.css` has no `cursor: pointer` on `button`. (Preflight removed the v3 override; UA default is `default`.) |
| `@source inline("{hover:,}bg-{red,blue,amber}-{50,{100..900..100},950}")` | **VERIFIED** syntax. [Detecting classes, safelisting](https://tailwindcss.com/docs/detecting-classes-in-source-files). |
