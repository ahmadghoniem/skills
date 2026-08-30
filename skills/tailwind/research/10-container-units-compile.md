# 10 — Container query units, compiled

Evidence for the container-unit paragraph added to `tailwind/references/gotchas.md` under
*"`@md:` is a container query, not a breakpoint"*.

`tailwindcss@4.3.3` + `@tailwindcss/cli@4.3.3` in `%TEMP%\tw-verify\cqtest`, isolated with
`@import "tailwindcss" source(none);` and an explicit `@source "./index.html";`.

## Input

```html
<div class="@container">
  <p class="text-[4cqi] w-[50cqi] max-w-[60cqw] p-[2cqi] h-[50cqh] gap-[1cqb]"></p>
</div>
```

## Emitted

Exit **0**, 46ms, no warning:

```css
@layer utilities {
  .\@container   { container-type: inline-size; }
  .h-\[50cqh\]   { height: 50cqh; }
  .w-\[50cqi\]   { width: 50cqi; }
  .max-w-\[60cqw\] { max-width: 60cqw; }
  .gap-\[1cqb\]  { gap: 1cqb; }
  .p-\[2cqi\]    { padding: 2cqi; }
  .text-\[4cqi\] { font-size: 4cqi; }
}
```

## Reading

Tailwind has **no named container-unit utilities** — every one of these is an arbitrary value,
passed through verbatim. That is the whole mechanism: Tailwind does not parse the unit, so it
cannot warn about one that will not resolve.

`.@container` sets `container-type: inline-size`, which establishes a query container on the
**inline axis only**. Per CSS Containment 3, a container query length unit whose axis has no
eligible container resolves against the **small viewport** instead. So `h-[50cqh]` and
`gap-[1cqb]` compile clean, ship, and silently behave as `50svh` / `1svb` — the block-axis units
are not errors, they are wrong answers.

`cqi` (inline) and `cqw` (width) do resolve, because that is the axis `inline-size` establishes.
`cqmin` / `cqmax` are mixed-axis and inherit the same fallback for their block half.

The failure has no build-time tell at all — no missing class, no diagnostic, no exit code. It
shows up only as a component sized to the window when it was meant to be sized to its slot.

**Verdict: CONFIRMED — compiled** for the pass-through and the silence. The fallback-to-viewport
half is **documented** (CSS Containment Module Level 3, container query length units), not
observable from `out.css`.

Made `container-type: size` an explicit non-recommendation in the skill by omission: it would make
`cqh` resolve, but it imposes block-axis containment too, which requires the element's height to
be independent of its contents — the exact hazard the surrounding paragraph already warns about.
