# Reusable affordances (`@utility`)

Read this **before** proposing that a repeated class string become a named class, and when
a project already has a `@layer components` block.

## The gate: where a framework owns the markup, the answer is a component

Do not skip this. Most repeated class strings should not become classes at all.

Tailwind's own *Managing duplication* docs say reuse across files becomes *"a **component** if
you're using a front-end framework like React, Svelte, or Vue"*, and scope the custom-CSS
escape hatch to projects using *"a templating language … **instead of** something like React
or Vue"*. Adam Wathan, on `@apply`
([#7651](https://github.com/tailwindlabs/tailwindcss/discussions/7651)): *"raw utility classes
are by far easier to maintain than custom classes created with `@apply` … makes your site
harder to maintain."*

**So in a React/Vue/Svelte codebase, a repeated class string is a missing component. Stop
there.** Making it a CSS class moves the duplication rather than removing it: the styles land
in a file the reader has to go find, and the props that should have driven the variants never
get written.

`@utility` is for what's left over — markup no component can own (CMS/Markdown output, a
third-party widget, email HTML), or one design system consumed from more than one framework.
Everything below applies only once that is true.

## Promote when it repeats and carries a name

Same trigger as the `@theme` ladder in `SKILL.md`, one level up. A **value** that repeats
becomes a theme token; a **class string** that repeats, and that someone would give a name
to, becomes an affordance.

- Repeats in >1 place *and* has a name people say out loud ("the badge", "the toolbar
  button") -> `@utility`.
- Repeats but has no name — three unrelated things happen to share `flex items-center
  gap-2` -> leave it. An affordance nobody can name is a coincidence, not a pattern.
- Appears once -> leave it. Utilities in the markup are the default, not a failure state.

Prefix the name (`ui-`, `app-`, the project's own) so it reads as an affordance rather than
a legacy semantic class, and so IntelliSense groups them under one keystroke.

## The pattern

```css
@utility ui-badge {
  :where(&) {
    @apply inline-flex items-center rounded-full border px-2 py-0.5 text-xs
           bg-primary text-primary-foreground;

    & > svg { @apply size-3 pointer-events-none; }

    @variant hover { @apply bg-primary/90; }
    @variant focus-visible { @apply ring-2 ring-ring/50; }
    @variant aria-invalid { @apply border-destructive; }
  }
}
```

Three things are load-bearing:

- **`@utility`, not `@layer components`.** Compiled on 4.3.3: a `@utility` that no source
  file uses is **absent** from the output; a `.legacy-unused` in `@layer components` is
  **emitted anyway**. `@utility` also registers as a real utility, so `hover:ui-badge` and
  `md:ui-badge` compile — `hover:legacy-badge` does not exist and never will.
- **`:where(&)`, not a bare `&`.** It flattens to `:where(.ui-badge)` at specificity
  `0,0,0`, so a `ui-badge bg-red-500` class list lands the red without `!`. The sharper
  case is descendants: `:where(.ui-badge) > svg` is `0,0,1` and loses to a `size-4` on the
  svg itself, where a bare `.ui-badge > svg` is `0,1,1` and silently overrides it. Without
  `:where()` you are relying on Tailwind's emission order inside `@layer utilities`, which
  is not a contract.
- **`@apply` against the project's theme, not raw CSS.** The affordance then follows the
  host's `--color-primary` and `--spacing` instead of forking a parallel design system.
  Reserve plain declarations for things with no utility (`background-size`, a `@property`).

`@variant hover { ... }` is the block form of `hover:`; it compiles to the same
`&:hover { @media (hover: hover) { ... } }`. Use it over a long `hover:`-prefixed string —
one block per state reads at a glance, and it dodges the colon-parsing problem in Vue /
Svelte / Astro `<style>` blocks.

## What this does not license

- **Not a components layer by another name.** The point is fewer named classes, each
  earning its name — not a `.ui-*` mirror of every div in the app.
- **Not for one-offs.** An affordance used once is a class the reader has to go look up.
- **Never migrate an existing `@layer components` block unprompted.** It is valid v4 and it
  works. Raise it as a candidate with the tree-shaking and variant reasons; let the user
  decide.
- **Don't drop `:where()` to "win" a specificity fight.** If a utility isn't overriding the
  affordance, the affordance is styling something it shouldn't.

## Verify it, don't assume it

Two failure modes are silent, so check the built CSS rather than the browser:

- **The name never got scanned.** `@utility` output only exists if the literal class string
  appears in a scanned source file. Built through `cn()` from fragments, or in a file
  outside `@source`, it is simply absent — the same trap as a dynamic `bg-${x}` class.
- **`@apply` in a scoped `<style>` block** needs `@reference`, or it errors with "Cannot
  apply unknown utility class". See `gotchas.md`.
