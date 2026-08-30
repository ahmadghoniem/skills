> **Archive.** Instruction file for round 2 (compile). Not findings. Output: `research/05-build-verification.md`. Prior: [BRIEF.md](BRIEF.md). Next: [BRIEF-3.md](BRIEF-3.md).

# Research brief 2 — settle the UNVERIFIED claims by BUILDING, not by searching

Round 1 (`research/02-claim-audit.md`) left four claims UNVERIFIED because they cannot be settled
from documentation — they need a real Tailwind compile. **Your job is to actually run Tailwind
and report what it emits.** Web search is a fallback only, not the method.

Do **NOT** edit anything under `tailwind/`. Write one report: `research/05-build-verification.md`.

## Setup

Work in a scratch directory **outside** this project, e.g. `%TEMP%\tw-verify`. Do not create
node_modules inside this workspace.

```
npm init -y
npm i -D tailwindcss@4.3.3 @tailwindcss/cli@4.3.3
```

Pin **4.3.3** — that is the version the skill claims to be verified against. Record the exact
resolved version in the report. Compile with the CLI (`npx @tailwindcss/cli -i in.css -o out.css`)
and read `out.css` directly. For each claim, paste the **actual emitted CSS** into the report.
If a build errors, paste the **verbatim error text**.

---

## Claim 2 — `oklch()` comma form passes through untouched

The skill states: *"`oklch()` has no legacy comma form. Tailwind does **not** validate this —
`oklch(0.7 0.1 250, 0.5)` passes through the build untouched and no warning appears; the
*browser* drops the declaration at parse time. A green build is not evidence the colour works."*

Test: define a theme token with the invalid comma form, use it via a utility.

```css
@import "tailwindcss";
@theme { --color-bad: oklch(0.7 0.1 250, 0.5); }
```
…with `bg-bad` in a source file.

Report: (a) does the build succeed? (b) exit code, (c) **full stdout + stderr verbatim** — is
there any warning at all? (d) the emitted `.bg-bad` rule, byte for byte. (e) Repeat with the
value in a plain `:root` block instead of `@theme` and note any difference.

## Claim 11 — same-property winner is emission order

The skill states, "verified in 4.3.3": *"`.w-32` is emitted before `.w-full`, so **`w-full`
wins**; `.text-lg` before `.text-sm`, so **`text-sm` wins**."*

Round 1 confirmed the width pair from issue #17726 but never re-emitted the font-size pair.

Test: put `w-32 w-full text-sm text-lg p-2 p-4` in a source file, compile, and read the order of
the generated rules in `out.css`.

Report, for each pair, **which selector appears first in the output file** and therefore which
one wins in the cascade:
- `.w-32` vs `.w-full`
- `.text-sm` vs `.text-lg`  ← the one actually in question
- `.p-2` vs `.p-4` (the skill claims spacing sorts ascending so the larger always wins)

Then re-run with the classes written in the **opposite order** in the source file, to prove
source order does not affect emission order. Paste both outputs.

Also record: does `text-sm`/`text-lg` emit `font-size` **and** `line-height`? If they emit
different property sets, the "winner" may be per-property rather than whole-class — say so
explicitly, because that would change how the skill should word the rule.

## Claim 23 — `--spacing(6)` in an unprocessed block

The skill states: *"`--spacing(6)` will not work here. It is a Tailwind build-time function, not
a CSS variable — in an unprocessed block it hard-errors (`The --spacing(…) function requires
that the --spacing theme variable exists`)."*

Test two things separately:
1. `--spacing(6)` inside a file compiled by Tailwind but with **no** `@import "tailwindcss"` /
   no theme — capture the **exact** error string.
2. `--spacing(6)` in a file with `@reference "tailwindcss"` — does it resolve?

Report the verbatim error text (the skill quotes it, so the quote must match) or, if the message
has changed, the current wording.

## Claim 24 — the v3 `@tailwind` trio

The skill states: *"This does **not** error in v4. Only `@tailwind utilities` is still honoured,
so the build succeeds and emits utilities — with no Preflight and no theme variables, leaving
every `bg-background`-style token dead. A build that 'works' but renders unstyled is this."*

Round 1 found docs calling the directives "removed" and an issue describing an **error**.

Test: an entry file containing exactly
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```
with a source file using `flex p-4 bg-red-500`.

Report: (a) exit code, (b) verbatim stdout/stderr, (c) if it succeeds — does `out.css` contain
Preflight (look for the `*,::before,::after` reset and `box-sizing`)? Does it contain `:root`
theme variables (`--color-red-500`, `--spacing`)? Does it contain `.flex` / `.p-4` / `.bg-red-500`?
(d) State plainly which of these three is true: **hard error** / **silent success with utilities
only, no Preflight, no theme vars** (what the skill claims) / **something else**.

## Bonus — what is `shadcn/tailwind.css`?

https://ui.shadcn.com/docs/theming now shows the default theme starting with:

```css
@import "tailwindcss";
@import "shadcn/tailwind.css";
```

I have confirmed that line is on the page. I do not know what it *does*. Find out:
- Which npm package ships it (`shadcn`? a subpath export?) and its current version.
- What is inside the file — does it provide `@custom-variant dark (&:is(.dark *))`, base-layer
  resets, `@utility` definitions, animations (`tw-animate-css` replacement)?
- Is it **required** for the current default theme to work, or additive sugar?
- Does `npx shadcn@latest init` write it automatically?
- Critically: **does it replace the hand-written `@custom-variant dark` line?** Our skill's
  scaffold writes that line manually. If `shadcn/tailwind.css` now provides it, writing it by
  hand may be redundant or conflicting.

Prefer reading the actual published package (`npm pack shadcn` / unpkg / the shadcn-ui GitHub
repo) over blog posts. Paste the file's real contents if you can retrieve them.

---

## Output — `research/05-build-verification.md`

- One section per claim, each ending with a bold one-line verdict: **CONFIRMED** / **WRONG** /
  **CHANGED** (with the new behaviour).
- Paste real emitted CSS and real error text. No paraphrasing of output.
- Record the resolved Tailwind version at the top.
- Where a claim is WRONG, quote the skill's exact sentence and give corrected wording.
- If you could not run something, say which and why — do not fill the gap with a doc citation
  and call it verified. That is the entire point of this round.
