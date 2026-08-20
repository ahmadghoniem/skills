# 07 — Missing-token failures, compiled

Closes two of the "no evidence in any research file" gaps `CLAIMS.md` flags, both from
`tailwind/references/setup.md`:

> **`--popover` / `--popover-foreground`** … omitted, `bg-popover` is a silent no-style in a class
> attribute and a hard *"Cannot apply unknown utility class"* under `@apply`. **`--radius-xl`** is
> used by Card; without it `rounded-xl` silently falls back to Tailwind's stock 0.75rem instead of
> tracking `--radius`.

`tailwindcss@4.3.3` + `@tailwindcss/cli@4.3.3`, three isolated directories in `%TEMP%\gaptest`,
each with `@import "tailwindcss" source(none);` and an explicit `@source`.

---

## 1. `--radius-xl` omitted from the bridge

```css
@theme inline {
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
}
:root { --radius: 0.625rem; }
```
Source: `<div class="rounded-sm rounded-md rounded-lg rounded-xl rounded-2xl"></div>`

Exit **0**, no warning. Emitted theme layer still carries Tailwind's stock rungs:

```css
--radius-xl: 0.75rem;
--radius-2xl: 1rem;
```

Emitted utilities:

```css
.rounded-2xl { border-radius: var(--radius-2xl); }   /* 1rem     — stock */
.rounded-lg  { border-radius: var(--radius); }       /* 0.625rem — tracks --radius */
.rounded-md  { border-radius: calc(var(--radius) * 0.8); }
.rounded-sm  { border-radius: calc(var(--radius) * 0.6); }
.rounded-xl  { border-radius: var(--radius-xl); }    /* 0.75rem  — stock, NOT --radius */
```

`@theme inline` **extends** the default theme rather than replacing it, so the un-bridged rungs
silently keep Tailwind's stock values. A Card at `rounded-xl` renders 0.75rem while every other
radius in the app scales from `--radius` — visible as one component whose corners do not move
when `--radius` is changed.

**CONFIRMED.** Applies equally to `--radius-2xl` (and to `-3xl` / `-4xl`, which current shadcn
also ships).

---

## 2. `bg-popover` with no `--color-popover`, in a class attribute

```css
@theme inline { --color-card: var(--card); }
:root { --card: oklch(1 0 0); }
```
Source: `<div class="bg-card bg-popover text-popover-foreground"></div>`

Exit **0**. No warning, no diagnostic. Entire utilities layer:

```css
@layer utilities {
  .bg-card { background-color: var(--card); }
}
```

`.bg-popover` and `.text-popover-foreground` are **not emitted at all** — not emitted broken. The
class stays in the markup and does nothing.

**CONFIRMED** — silent no-style.

---

## 3. The same token under `@apply`

```css
.my-popover { @apply bg-popover; }
```

Exit **1**. **No `out.css` written.** stderr:

```
Error: Cannot apply unknown utility class `bg-popover`
```

**CONFIRMED**, and the skill's quoted string matches the real message.

---

## Why the pair matters

Same missing token, two completely different signals: silent in markup, fatal under `@apply`. A
project that only uses the token in class attributes ships broken styling with a green build; the
moment someone `@apply`s it the build dies. That asymmetry is the reason the setup scaffold calls
these tokens out by name.
