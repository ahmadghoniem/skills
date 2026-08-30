# Research brief 4 — compile out the last unevidenced claims

`research/CLAIMS.md` lists claims in the shipped skill with no evidence behind them in any
research file. Two were closed by `research/07-missing-token-compile.md` and one by
`research/06-state-specificity-compile.md`. **Six remain.** Settle them.

**Method matters more than the verdict.** Where a claim can be compiled, compile it and paste the
emitted CSS. Where it cannot (a library's runtime behaviour, another tool's capability), say so
explicitly and use the next-best method named below — do not dress a doc citation up as a
verification.

Do **NOT** edit anything under `tailwind/`. Write one report: `research/08-remaining-claims.md`.

## Setup

A pinned scratch install already exists at `%TEMP%\tw-verify` (tailwindcss + @tailwindcss/cli,
both **4.3.3**). Reuse it or make a fresh one, but stay on 4.3.3 and record the resolved version.
Do not create `node_modules` inside this workspace. Compile with
`node node_modules/@tailwindcss/cli/dist/index.mjs -i in.css -o out.css` and read `out.css`.

Use `@import "tailwindcss" source(none);` plus an explicit `@source "./index.html";` in each test
so the scanner cannot pick up files from sibling test directories.

---

## 1. `h-screen` vs `h-dvh`  — COMPILE

Skill (`gotchas.md`): *"`h-screen` ignores mobile browser chrome. Use `h-dvh` (dynamic viewport
height) for full-height mobile layouts."*

Compile `h-screen h-dvh h-svh h-lvh` and paste the four emitted rules. Confirm `h-screen` is
`100vh` and `h-dvh` is `100dvh`.

The *behavioural* half — that `vh` ignores dynamic browser chrome while `dvh` tracks it — is a CSS
spec fact, not a Tailwind one. Cite the spec or MDN for it and label it **documented**, not
compiled. Note whether `h-svh` / `h-lvh` exist as utilities, since the skill mentions neither.

## 2. `line-clamp-*` — COMPILE

Skill (`gotchas.md`): *"`line-clamp-*` is a different mechanism — it clamps *lines*, requires the
text to wrap, and never wants a width constraint or `whitespace-nowrap`."*

Compile `line-clamp-3` and `truncate` side by side and paste both rule bodies. Then reason **from
the emitted properties**: does `line-clamp-3` set `overflow: hidden`, `display: -webkit-box`,
`-webkit-box-orient: vertical`, `-webkit-line-clamp`? Does `truncate` set `overflow: hidden;
text-overflow: ellipsis; white-space: nowrap`?

The claim to test is specifically: **does `whitespace-nowrap` defeat `line-clamp-*`?** Explain
from the emitted declarations why, and say whether "never wants a width constraint" is accurate
or overstated — a width constraint is harmless for line-clamp, so if the skill's wording implies
otherwise, flag it.

## 3. `next-themes` `attribute="class"`  — READ THE PACKAGE

Skill (`setup.md`): *"`attribute=\"class\"` toggles `.dark` on `<html>`, which is what
`@custom-variant dark (&:is(.dark *))` keys off."*

Not compilable — this is `next-themes` runtime behaviour. `npm pack next-themes` (or read the
published source on unpkg / GitHub) and confirm from the **actual implementation** that
`attribute="class"` adds the resolved theme name as a class on `document.documentElement`.
Record the version you inspected. Quote the relevant lines. Label **source-read**, not compiled.

Also check: is `attribute="class"` still the current API, or has it been renamed/defaulted since?

## 4. Mobile-first `sm:hidden md:block` — COMPILE

Skill (`gotchas.md`): *"Unprefixed applies everywhere; `md:` applies at md **and up**.
`sm:hidden md:block` = hidden on small, shown md+ (not \"only md\")."*

Compile `sm:hidden md:block` and paste the emitted media queries **in order**. Confirm the
breakpoint values (`sm` = 40rem, `md` = 48rem) and that both are `min-width`-style
(`width >= …`) rules.

Then state plainly what an element with both classes renders at three widths: 30rem, 44rem,
50rem. This is a cascade question — derive it from the emitted order, and note that "hidden on
small" is loose wording since below `sm` the element is *visible* (neither rule matches). If the
skill's phrasing is misleading, say so and give corrected wording.

## 5. `--popover` consumers — READ CURRENT SHADCN SOURCE

Skill (`setup.md`): *"`--popover` / `--popover-foreground` are used by Popover, Dialog,
DropdownMenu, Select, Command and Tooltip."*

`02-claim-audit.md` confirmed Popover / DropdownMenu / ContextMenu from the official token table
and Select from source, but left **Dialog, Command, Tooltip** unverified.

Read the current shadcn registry source for those three and grep for `bg-popover` /
`text-popover-foreground`. Report which of the six the skill names are actually correct, which
are wrong, and whether any consumer the skill omits should be added (ContextMenu, Combobox,
Menubar, NavigationMenu…). Give the file path and the matched line for each. Label **source-read**.

## 6. Biome `useSortedClasses` and custom utilities — RUN BIOME

Skill (`editor.md`): *"it only understands the **default** Tailwind config — it cannot see your
`@theme`, custom utilities, or variants."*

`02-claim-audit.md` confirmed nursery + unsafe fix but left the custom-utility blindness
**UNVERIFIED**. This one is testable: install Biome in the scratch dir, enable
`lint/nursery/useSortedClasses`, and give it a file containing a custom `@utility` class and a
custom `@custom-variant` alongside stock utilities.

Report: does it sort the custom ones sensibly, ignore them, or misplace them? Paste the config
you used, the input, and Biome's output/diagnostics. Record the Biome version. If the rule now
has an option that points it at a stylesheet, say so — that would make the skill's claim stale
rather than wrong.

---

## Output — `research/08-remaining-claims.md`

- One section per claim. Each ends with a bold verdict: **CONFIRMED** / **WRONG** / **OVERSTATED**
  / **UNVERIFIABLE**, plus the method actually used: **compiled** / **source-read** / **tool-run**
  / **documented**.
- Paste real output. No paraphrase of emitted CSS or tool diagnostics.
- Where a claim is WRONG or OVERSTATED, quote the skill's exact sentence and give corrected
  wording in the skill's voice (terse, imperative, reason before rule).
- End with a table: claim → verdict → method, ready to merge into `research/CLAIMS.md`.
- If something could not be run, say which and why. A gap named is worth more than a citation
  pretending to be a test.
