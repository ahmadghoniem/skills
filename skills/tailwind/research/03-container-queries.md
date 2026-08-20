> **Provenance:** **live**. Folded into `tailwind/references/gotchas.md` and the SKILL.md viewport-vs-container line. Index: [README.md](README.md).

# Task 3 — Container queries

## Would change the skill

Keep the defensive core (`@md:` ≠ `md:`; do not blindly convert viewport variants). **Add a short decision rule and named-container syntax** to `gotchas.md`. Do not turn this into a container-query tutorial, and do not tell the agent to restyle shadcn primitives with `@container`.

shadcn’s current default components (card, button, sidebar tokens) are **viewport- and token-driven**, not `@container`-driven. Overlay tokens (`popover`) and `rounded-xl` on Card are unrelated to container queries.

---

## Built into v4 core?

**Yes.** Container queries are first-class in v4. Delete `@tailwindcss/container-queries` and any `@plugin` for it. `@container` plus `@sm:` / `@md:` / `@lg:` … `/@7xl:` and `@max-*` ship in core.

Sources: https://tailwindcss.com/blog/tailwindcss-v4 · https://tailwindcss.com/docs/responsive-design

## Browser support / hold back?

**Do not hold back for a typical shadcn/v4 app.** Size container queries are Baseline widely available (MDN: since Feb 2023). Can I Use global usage for `container: inline-size` is ~94%. Tailwind v4’s own floor (Chrome 111 / Safari 16.4 / Firefox 128) already assumes this generation of CSS.

Hold back only if a product requirement still includes pre-2023 browsers — in which case the project should not be on Tailwind v4 at all.

Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container · https://caniuse.com/mdn-css_properties_container_inline-size · https://tailwindcss.com/docs/upgrade-guide

## Decision rule (agent-applicable)

**If the thing that must change is the page chrome (header, app shell, whether a sidebar exists, marketing breakpoints), use viewport `md:` / `lg:`.**

**If the same component is dropped into slots of different widths (sidebar vs main vs dialog) and the layout should follow the slot, put `@container` on the slot (or on the component root) and use `@md:` / `@lg:` inside.**

Do not convert a page-level `md:grid-cols-2` into `@md:grid-cols-2`. Do not add `@container` to a full-width page wrapper just to restyle children that already track the viewport.

That is the same split both articles argue; the numbers in the Easton post’s container table are **wrong** (it lists `@md` as 448px without rem, and `@sm` as 384px as if they were viewport-adjacent). Official:

| | Viewport `md:` | Container `@md:` |
| --- | --- | --- |
| Query | `@media (width >= 48rem)` | `@container (width >= 28rem)` |

Sources: https://tailwindcss.com/docs/responsive-design · https://eastondev.com/blog/en/posts/dev/tailwind-responsive-layout-container-queries/ · https://richdynamix.com/articles/tailwind-v4-container-queries-component-responsive

## What is worth teaching

**Teach (one block in `gotchas.md`):**

- `@container` → `container-type: inline-size`. Variants apply to **descendants** of that container, not to the container element’s own layout in the usual “self-query” sense — style the children (or wrap an inner root).
- Named: `@container/main` + `@lg/main:` when nested containers would otherwise hit the wrong ancestor.
- `@max-md:` (container) vs `max-md:` (viewport). Same `@` vs no-`@` trap as min variants.

**Mention once, do not make house-style defaults:**

- Container units `cqw` / `cqi` / `cqb` as arbitrary values (`text-[clamp(1rem,4cqi,2rem)]`). Useful for fluid type inside a slot; easy to overuse. Prefer scale steps unless the user asked for fluid type.

**Do not teach as required:** `@min-*` stacking, style queries, scroll-state queries.

Syntax (v4, official):

```html
<div class="@container">
  <div class="flex flex-col @md:flex-row">…</div>
</div>

<div class="@container/main">
  <div class="@sm/main:flex-col">…</div>
</div>
```

Source: https://tailwindcss.com/docs/responsive-design

## Traps

- **Wrong ancestor:** `@md:` without an `@container` ancestor compiles but never matches (skill already says this). Nested `@container` without a name queries the **nearest** container.
- **`container-type: inline-size` is size containment on the inline axis.** It applies to **that element**. Descendants query it; the element itself does not “see” its own size for `@md:` on the same node in the usual pattern. Size containment can interact badly with **percentage heights**, some **sticky** descendants, and overflow measurement — this is CSS containment, not a Tailwind bug. There is no Tailwind-specific perf cliff documented; extra layout for containers is real but not a reason to ban them.
- Easton/RichDynamix do not document a sticky/overflow footgun with citations. Treat sticky + `@container` on the **same** node as “verify in the browser”, not as a skill hard rule.

Sources: https://tailwindcss.com/docs/hover-focus-and-other-states · https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container · https://web.dev/blog/how-to-use-container-queries-now

## shadcn

Official theming/token docs do **not** use `@container`. Card is `rounded-xl bg-card`. Sidebar theming is token-based (`sidebar-accent`, etc.), not container queries. Blocks that use a CSS `container` class (max-width page shell) are the old **viewport `container` utility**, not `@container`. Do not migrate shadcn `md:` in primitives to `@md:`.

Sources: https://ui.shadcn.com/docs/theming · https://ui.shadcn.com/docs/components/base/card

## Proposed prose

### `tailwind/references/gotchas.md` — replace the short `@md:` section with:

**`@md:` is a container query, not a breakpoint.** `md:` is the viewport (`@media (width >= 48rem)`). `@md:` is the container (`@container (width >= 28rem)`). Different mechanism, different size. Swapping one for the other changes what the layout responds to.

**Decision rule:** viewport variants for page chrome (shell, nav visibility, marketing breakpoints). `@container` + `@md:` when a **reusable component** must follow its **slot** width, not the window — a card in a sidebar vs the same card in the main column.

Mark the slot (or the component root) with `@container` (`container-type: inline-size`). `@sm:` / `@md:` on descendants do nothing without that ancestor. Nested slots: name it (`@container/main`, `@lg/main:`) so you query the slot you meant.

`@max-md:` is the container max variant; `max-md:` is the viewport max variant. Same `@` trap.

Do not convert existing page-level `md:`/`lg:` to `@md:`/`@lg:` during cleanup. Do not put `@container` on a full-bleed page wrapper as a “modern default.”

Container units (`cqi`, `cqw`) are valid in arbitrary values. Use them for slot-fluid type/spacing the user asked for; do not invent a parallel type scale in `cqi`.

### `tailwind/SKILL.md` — keep the existing “Don’t convert viewport variants into container queries” line. Add one clause:

Reach for `@container` when authoring a component that will live in more than one slot width; otherwise keep `md:`/`lg:`. Details in `references/gotchas.md`.

### `tailwind/references/cleanup.md` — no new auto-apply. Optionally under “Never touch”:

Do not rewrite `md:` ↔ `@md:` (or `lg:` ↔ `@lg:`) as a canonicalisation. They are different queries.

### `tailwind/references/setup.md` — **change nothing.** Do not add `@container` to the globals scaffold.
