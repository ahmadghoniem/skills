# Brief 5 — make the audit mechanical, portable, and re-verifiable

Seven changes to `skills/tailwind/`. Unlike briefs 3 and 4, this one **edits the shipped skill**. Every fact below that the skill will assert has already been compiled or diffed; your job is the edits, the scripts, the fixtures, and the provenance rows, in the order given. Each item ends on a **Done when** list; an item is done when every line of that list is true, and only then.

## Ground rules

- Work at the repo root. The skill is `skills/tailwind/`; paths below are relative to it unless they start with `skills/` or `.claude-plugin/`.
- **LF line endings, always.** `.gitattributes` pins them. A CRLF `SKILL.md` breaks frontmatter parsing (`research/11-crlf-frontmatter.md`); a CRLF `.mjs` breaks Vite. Check with `git ls-files --eol skills/tailwind | grep -v 'i/lf'` before committing: the output must be empty.
- **Zero dependencies in `scripts/`.** `node` only, `import` from `node:*` only. The skill installs as markdown plus one script; keep it that way.
- The skill's word for a rewrite it performs unasked is **auto-apply**; for one it reports and leaves is **flag**. Use those two words in everything you write into `references/cleanup.md`; they already anchor the whole file.
- The skill's evidence classes are **compiled** (read from Tailwind's output), **source-read**, **tool-run**, **documented**. Every new sentence of fact in the skill gets a row in `research/CLAIMS.md` carrying one of those.
- Phrase rules as the target behaviour, and keep prohibitions only where the skill already uses one as a guardrail (the *Do not over-correct* and *Never touch* lists). Match the surrounding voice: terse, concrete, one example per rule.
- Tooling is already here: `node`, `npm`, `claude` (`/usr/bin/claude`; the eval items need it authenticated, see item 6). Tailwind `latest` is **4.3.3** (`npm view tailwindcss dist-tags`), `eslint-plugin-better-tailwindcss` is **4.7.0**, `shadcn` is **4.21.0**. Check the dist-tags once yourself and write what you see, not these numbers.
- Compile fixtures **isolated**: one fixture per directory. `--content` is additive and v4 auto-sources the entry file's directory, so a neighbouring fixture leaks classes into a run that must prove a class *absent* (`research/12-…` *Method*). Use `@import "tailwindcss" source(none);` plus an explicit `@source` when you need a hard boundary.

Compile recipe, used throughout:

```bash
mkdir -p /tmp/tw/<name> && cd /tmp/tw/<name>
npm init -y >/dev/null && npm i tailwindcss@latest @tailwindcss/cli@latest --silent
# write in.css and in.html
npx @tailwindcss/cli -i in.css -o out.css --content in.html
```

---

## 1. Portable script path

**Why.** `SKILL.md` line 36–37 and `references/cleanup.md` (*Colour format*) invoke `node ~/.claude/skills/tailwind/scripts/oklch.mjs`. That path exists only for the manual-copy install. The README's primary install is the `kit` plugin, where the file lives under `~/.claude/plugins/cache/ahmadghoniem/kit/<version>/skills/tailwind/scripts/`; a project-local `.claude/skills/tailwind` install fails the same way.

**Fact.** Claude Code substitutes `${CLAUDE_SKILL_DIR}` (the directory holding `SKILL.md`; for plugin skills, the skill's subdirectory, not the plugin root) in two places: the skill's markdown body and Bash rules in `allowed-tools`. Using it in both lets the script run without a permission prompt. Source: code.claude.com/docs/en/skills, *Available string substitutions*. Verified 2026-09-14 that `allowed-tools` in this skill's frontmatter passes `claude plugin validate . --strict`.

**Edits.**

1. Replace every `~/.claude/skills/tailwind/scripts/oklch.mjs` in `SKILL.md` and `references/cleanup.md` with `${CLAUDE_SKILL_DIR}/scripts/oklch.mjs`. The README's install/uninstall paths (`cp … ~/.claude/skills/tailwind`, `rm -rf …`) are human instructions and stay.
2. Add to `SKILL.md` frontmatter, after `license: MIT`:
   ```yaml
   allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/oklch.mjs *)
   ```
3. In `README.md` *What actually loads*, one sentence: the script is referenced through `${CLAUDE_SKILL_DIR}`, so the same `SKILL.md` works from the plugin cache, `~/.claude/skills`, and a project `.claude/skills`.

**Done when.**
- `grep -rn '~/.claude/skills/tailwind/scripts' SKILL.md references/` prints nothing.
- `grep -c 'CLAUDE_SKILL_DIR' SKILL.md` is ≥ 2 (frontmatter + body).
- `claude plugin validate . --strict` (from repo root) passes.
- `research/CLAIMS.md` has a row for the substitution, verdict *documented*, source the docs URL above.

---

## 2. `oklch.mjs --check`

**Why.** The *Colour format* candidates in `cleanup.md` are all manual greps today, and the one tool the skill ships hides the very bug `SKILL.md` warns about: `echo 'oklch(0.7 0.1 250, 0.5)' | node scripts/oklch.mjs` prints `oklch(0.7 0.1 250 / 0.5)` and exits 0. Good for conversion, useless for detection.

**Build** a `--check <file> […]` mode in `scripts/oklch.mjs`. It reads each file and reports **findings**; conversion mode is untouched. Rules, with the finding label to print:

| # | Where | Pattern | Label | Severity |
| --- | --- | --- | --- | --- |
| a | anywhere | `oklch(` … `,` … `)` (a comma inside the parens) | `comma-alpha` — browser drops the declaration | hard |
| b | a custom property inside `:root {}`, `.dark {}`, `@theme {}` (not `@theme inline` values that are `var(--x)`) | value is bare channels: `^\s*[\d.]+%?\s+[\d.]+%?\s+[\d.]+%?\s*$` | `bare-channels` — token is dead | hard |
| c | same blocks | `#hex`, `rgb(`, `hsl(` **not** wrapped around `var(` | `not-oklch` — print the Before/After row using the existing converter | house-style |
| d | same blocks | `hsl(var(--x))` / `rgb(var(--x))` | `wrapped-var` — complete colour, convert for house style only | soft |
| e | `:root {}` / `.dark {}` | `oklch(L C H / A)` with A < 1, **except** `--border` and `--input` under `.dark` | `baked-alpha` — move the fade to the utility | soft |
| f | anywhere | `oklch(L C H)` that the existing `inGamut` test rejects | `out-of-gamut` — reuse the existing stderr message | soft |
| g | non-CSS files (`.tsx .jsx .vue .svelte .astro .html .ts .js`) | `#[0-9a-f]{3,8}\b`, `rgb(`, `hsl(` outside class strings | `literal` — colour that cannot flip under `.dark` | flag |

Block detection: brace-match from the selector to its closing brace; nested braces (`@supports`, `@media` inside `.dark`) count. A regex per line is fine for a–g once you know which block a line is in.

Output shape, so the cleanup pass can paste it:

```
## path/to/globals.css
- L14 bare-channels  --background: 0 0% 100%
- L22 comma-alpha    --ring: oklch(0.7 0.1 250, 0.5)

| Token | Before | After |
| --- | --- | --- |
| `--primary` | `#0f172a` | `oklch(0.208 0.04 265.755)` |
```

Exit code: **1** if any *hard* finding, else **0**. Print `no findings` for a clean file. Update the usage line and the header comment. Document the stdin table trick in the header too: `grep -oh '#[0-9a-f]\{6\}' src/**/*.css | sort -u | node oklch.mjs --table` already works because the script reads stdin when given no colours; nothing to build, just say so.

**Done when.**
- A fixture `globals.css` containing one instance of each of a–f (write it into `evals/cleanup/fixture/` now; item 5 reuses it) produces exactly one finding per rule, correct line numbers, exit 1.
- The same file with a–b removed exits 0 and still lists c–f.
- shadcn's own dark hairlines `--border: oklch(1 0 0 / 10%)`, `--input: oklch(1 0 0 / 15%)` under `.dark` produce **no** `baked-alpha` finding; the same values under `:root` do.
- `@theme inline { --color-primary: var(--primary); }` produces no finding.
- `node scripts/oklch.mjs '#3b82f6'` still prints `oklch(0.623 0.188 259.815)` (the header's regression anchor).
- `SKILL.md` and `cleanup.md` invoke `--check` where the manual grep for `#[0-9a-f]{3,8}`, `rgb(`, `hsl(`, `style={{` sits today; the grep line goes. Keep the sentence about which colours to leave alone (`currentColor`, keywords, gradient interpolation, third-party configs) — the script does not know that, the agent does.

---

## 3. Audit for dead semantic utilities

**Why.** `research/07-missing-token-compile.md` compiled it: `bg-popover` with no `--color-popover` in `@theme` emits **nothing**, exit 0, no warning; `rounded-xl` with no `--radius-xl` in the bridge silently falls back to stock `0.75rem` instead of tracking `--radius`. The cleanup pass tells the agent to read the project's token names but never has it check the file's utilities against them, and the output format has nowhere to show that it did.

**Edits to `references/cleanup.md`.**

1. New first step in *Process*: **Inventory the tokens.** `grep -ohE -- '--(color|radius|spacing|shadow|font|text|breakpoint|container)-[a-zA-Z0-9-]+' <entry.css>` on the CSS entry point (the file with `@import "tailwindcss"`; find it with `grep -rl '@import "tailwindcss"' --include=*.css`). Also record whether `--spacing:` is redeclared and what `html`/`:root` `font-size` is — item 4 consumes both.
2. New candidate group, **Dead semantic utility**, between *Token drift* and *Colour format*: a `bg-/text-/border-/ring-/fill-/stroke-/outline-/from-/via-/to-/divide-/accent-/caret-/decoration-/placeholder-<name>` whose `<name>` is neither a stock palette colour (`red-500`, `slate-50`…), a keyword (`transparent current inherit white black`), nor a `--color-<name>` in the inventory → flag as dead (compiles to nothing). Same for `rounded-<step>` when `--radius-<step>` is missing from a project that bridges `--radius` — flag as "falls back to stock, does not track `--radius`". One sentence each, pointing at `gotchas.md` *Bare-channel tokens* for the shape of a silent miss.
3. Output format: the report opens with the inventory it read:
   ```
   ## path/to/Component.tsx
   Tokens: background foreground card popover primary … (from src/app/globals.css)
   ```
   One line. Every semantic name the report goes on to recommend must appear in it — that is the check that "read the project's token names" happened.
4. Where ESLint is configured, name the mechanical version: `better-tailwindcss/no-unknown-classes` catches exactly this once `entryPoint` is set (item 4 adds it to `editor.md`).

**Done when.**
- The fixture from item 5 contains `bg-popover` with `--color-popover` deliberately missing from its `globals.css`, and the expected report flags it under *Dead semantic utility*.
- The *Tokens:* line is in the output-format block and in `evals/cleanup/expected/report.md`.
- `CLAIMS.md` gets a row for the new candidate group, verdict *compiled*, source `07`.

---

## 4. Gate the px/rem auto-rewrites; extend `editor.md`

**Why.** `cleanup.md` auto-applies `p-[16px]` → `p-4`. `research/README.md` (decision table, *A custom `--spacing` gets one instruction*) records this as a known-wrong trade-off on any project that redeclares `--spacing`, and the same rewrite is wrong under a non-16px root font size. Item 3 now reads the entry point anyway, so the gate is two greps the agent has already run.

**Edits to `references/cleanup.md`, in *Auto-apply*.**

- Before the px/rem bullets, one gating sentence: *px → step and rem → step rewrites hold only when the inventory found no `--spacing:` redeclaration; px → step additionally needs `html`/`:root` `font-size` unset, `16px`, or `100%`. Otherwise these rows move to* Flag *for this project.* (rem → step depends only on `--spacing`; px → step depends on both.)
- New auto-apply row, compiled 2026-09-14 on 4.3.3: `bg-primary/[7%]` → `bg-primary/7` — identical output (`color-mix(in srgb, … 7%, transparent)`), same as the existing decimal row. `bg-primary/[0.07]` emits `7.000000000000001%`, which is why that row already exists.
- Update `research/README.md`'s decision-table row to say the gate now exists and costs two greps.

**Edits to `references/editor.md`, recommended config.** Add, with the same one-line reasons the block already uses:

```js
// A semantic utility with no @theme token compiles to nothing, exit 0. Needs entryPoint.
"better-tailwindcss/no-unknown-classes": ["warn", { ignore: [] }],
// Byte-identical repeats. Same rewrite the cleanup pass auto-applies.
"better-tailwindcss/no-duplicate-classes": "warn",
```

Then two sentences: `no-unknown-classes` is only meaningful with `entryPoint` (without it, every project token is "unknown"); put classes used for JS targeting in `ignore`, and leave `detectComponentClasses` at its default `false` — a house style built on `@utility` has no component classes for it to find. Rule list confirmed against the 4.7.0 package README (`npm pack eslint-plugin-better-tailwindcss@4.7.0`).

**Done when.**
- The gating sentence sits above the first px/rem row and names both greps' outcomes.
- The `/[7%]` row is present and `CLAIMS.md` has its compiled row.
- `editor.md`'s config block parses as JS (paste it into a `.mjs` inside an object literal and `node --check` it).
- The README decision-table row no longer says "does **not** gate".

---

## 5. Behaviour eval for the cleanup pass

**Why.** `evals/` tests only whether the skill fires. Nothing checks what the cleanup pass *does*, so an edit to `cleanup.md` can silently change every auto-apply.

**Build `evals/cleanup/`:**

```
evals/cleanup/
├── README.md            # how to run, what a pass is
├── fixture/
│   ├── globals.css      # the item-2 fixture: one of each check finding, --color-popover absent, --spacing NOT redeclared
│   └── Card.tsx         # one class list per rule below
├── expected/
│   ├── Card.tsx         # fixture after every auto-apply, nothing else changed
│   └── report.md        # the candidate lines that must appear
└── check.mjs            # node, zero deps: diff + substring assertions
```

`Card.tsx` carries, each on its own element so line numbers are stable:

- one of every *Auto-apply* row: `flex flex-row`, `px-4 py-4`, `h-5 w-5` (reverse order on purpose), `top-2 bottom-2`, an exact duplicate, `opacity-100`, `bg-primary/[0.07]`, `bg-primary/[7%]`, `p-[16px]`, `p-[1px]`, `min-w-[3.25rem]`, `z-[9998]`;
- one of every *Flag* group: `w-full w-32`; `hover:bg-x` beside `data-active:bg-y` (no compound); a `cn("p-2", cond && "p-4")` call; `bg-white dark:bg-gray-900`; `text-gray-500`; `bg-popover` (dead — no token); `bg-[#1da1f2]`; `rounded-[6px]`; `p-[13px]`; `block` on a `<div>`; `h-screen`; `truncate` inside a `flex` child with no `min-w-0`; a `style={{ color: "#333", top: rect.top }}`;
- one of every *Never touch* trap: `shadow-sm`, `[&:hover]:underline`, `md:flex-row`, `data-active:hover:bg-accent`, `[figure>&]:m-0`, a class referenced by `document.querySelector` in the same file.

`expected/Card.tsx` is the fixture with **only** the auto-apply rows rewritten and every trap byte-identical. `expected/report.md` lists, one per line, a substring that must appear in the agent's report for each flag (e.g. `bg-popover` and `dead`, `w-full w-32`, `p-[13px]`, `Tokens:`), and a second list of substrings that must **not** appear (e.g. `shadow-xs`, `@md:`, `ring-3`).

`check.mjs <run-dir> <report.md>`: byte-compares `<run-dir>/Card.tsx` with `expected/Card.tsx` (print a unified-style diff on mismatch), then asserts each must/must-not substring against the report. Exit 0 only when all pass; print a count.

`README.md` run recipe: copy `fixture/` to a temp dir, `cd` into it, run `claude -p "clean up the tailwind in Card.tsx" --output-format stream-json --verbose < /dev/null`, save the final assistant text as `report.md`, then `node evals/cleanup/check.mjs <tmp> <tmp>/report.md`. Note in it that a run without the skill firing is a void run, not a fail (check the stream for the `Skill` tool call, as `evals/run-trigger-eval.sh` does).

**Done when.**
- `node evals/cleanup/check.mjs evals/cleanup/expected evals/cleanup/expected/report.md` passes trivially (expected against itself) — proves the checker runs.
- `node scripts/oklch.mjs --check evals/cleanup/fixture/globals.css` exits 1 with one finding per rule a–f (item 2's criterion, same file).
- You ran the recipe once with the skill installed (`cp -r skills/tailwind ~/.claude/skills/tailwind`), and recorded the result — pass or fail, with the diff — in `research/13-…` (item 8). A fail here is a finding about `cleanup.md`, not about the fixture: fix the prose, rerun, record both.
- `skills/tailwind/README.md` *Layout* tree lists `evals/cleanup/`. `evals/` stays unreferenced from `SKILL.md`.

---

## 6. Trigger eval: commit the runner, measure `paths`

**Why.** `research/09-trigger-eval-run.md` measured positives at **0.3** in an empty directory, found seven queries that never fire under any description, and named two open items: nobody has run the eval inside a real Tailwind project, and a hook on file edits is the untested lever. The runner itself was never committed — its stdin bug voided a whole pass and lives only as a paragraph.

**Fact.** Claude Code skills now take a `paths` frontmatter field: glob patterns (same format as `.claude/rules` path-specific rules) that make Claude load the skill automatically when working with matching files. Passes `--strict` validation (verified 2026-09-14 with `**/*.css` and `**/*.{tsx,jsx,vue,svelte,astro,html}`). **Risk:** the docs say `paths` *limits* activation — a prompt-only query that touches no file (eval query 03, *audit these classes: `<div …>`*, fires today) may stop firing. That is what the measurement decides.

**Build `evals/run-trigger-eval.sh`** (bash; runs under Git Bash on the author's machine):

- args: `--cwd <dir>` (default: a fresh temp dir), `--runs N` (default 3), `--model` (default `sonnet`), queries from `evals/trigger-eval.json` via `node -e` JSON parsing (no `jq` dependency).
- per query, per run: `claude -p "$q" --output-format stream-json --verbose --max-turns 1 --model "$model" < /dev/null`, **`< /dev/null` mandatory** — comment the 09 bug beside it.
- fired = stream contains a `Skill` tool call whose input names `tailwind` (`grep -q '"skill":"tailwind"'` is what 09 used).
- output: one row per query — id, should_trigger, fires/runs — then positives rate and negatives rate; exit 1 if any negative fired.

**Measure**, three configurations, each ≥ 3 runs per query, all inside a real fixture: `evals/cleanup/fixture/` copied into a temp dir with a `package.json` depending on `tailwindcss@4`, a `CLAUDE.md` of one line ("Tailwind v4 + shadcn"), and `git init`:

1. current frontmatter, empty dir (reproduces 09's 0.3 baseline on your harness);
2. current frontmatter, fixture dir (the unmeasured case);
3. frontmatter plus `paths:` as above, fixture dir.

**Decide.** Ship `paths` only if (3) raises positives over (2) **and** every query that fired in (2) still fires in (3); negatives must stay at 0 fired throughout. Either way, write the numbers.

**Done when.**
- `bash evals/run-trigger-eval.sh --runs 1 --cwd /tmp/x` completes and prints the table (needs an authenticated `claude`; if `claude -p 'hi'` fails on auth, stop this item, do everything else, and say so in your report rather than inventing numbers).
- Three result tables are in `research/13-…`, with the verdict and the frontmatter that shipped.
- `evals/trigger-eval.json` `purpose` names the runner script.
- If `paths` ships: `README.md` *What actually loads* gains one sentence saying so, and `CLAIMS.md` gets a *tool-run* row citing `13`.

---

## 7. `research/verify.mjs` — rerun the compiles on `latest`

**Why.** Every row says "compiled on 4.3.3". When `latest` moves, nothing in the tree reruns them; today it took a hand-built scratch dir to confirm one row. The shadcn dump has the same problem: I diffed `shadcn@4.21.0` `dist/tailwind.css` against `research/archive/shadcn-4.18.0-tailwind.css` on 2026-09-14 — the nine `@custom-variant` names are identical and the body differs only by the archived file's header comment — but that check is a paragraph, not a command.

**Build `research/verify.mjs`** (node, zero deps beyond `npm` on `PATH`): creates a temp root, installs `tailwindcss@latest @tailwindcss/cli@latest` once, then for each check writes an **isolated** directory with `in.css` (`@import "tailwindcss" source(none); @source "./in.html";` plus the check's theme) and `in.html`, runs the CLI, and asserts on `out.css`. Print the resolved Tailwind version first, then one `PASS`/`FAIL` line per check, exit 1 on any FAIL.

Checks (each is an existing CLAIMS row; cite it in the source):

| Check | Assert |
| --- | --- |
| emission order `w-32` / `w-full` | `.w-32` index < `.w-full` index in `out.css` |
| emission order `text-lg` / `text-sm` | `.text-lg` before `.text-sm` |
| unused `@utility` absent, unused `@layer components` emitted | define both, reference neither in `in.html`; assert absence / presence |
| open-ended scales | `z-9998`, `p-18`, `w-101`, `grid-cols-7` all emit |
| bare channels | `--color-background: var(--background)` with `--background: 0 0% 100%`: `.bg-background` emits `var(--background)` verbatim (the dead shape) |
| `/[7%]` ≡ `/7` | both rules present, identical `color-mix(... 7%, transparent)` |
| missing `--radius-xl` | bridge without it: `.rounded-xl` emits `var(--radius-xl)` and theme layer has `--radius-xl: 0.75rem` |
| v3 entry file | `@tailwind base; @tailwind components; @tailwind utilities;` with `flex p-4 bg-red-500`: output contains `.flex` and neither `.p-4` nor `.bg-red-500` |
| `--spacing()` without theme | `source(none)` file with no `@import`, `.x { padding: --spacing(6) }`: CLI exits non-zero and stderr mentions `--spacing` |
| `:where()` variant specificity | `@custom-variant data-active (&:where([data-active]))`; assert `.data-active\:bg-…:where(` appears (the demotion shape from `06`) |
| shadcn variant set | `npm pack shadcn@latest`, extract `package/dist/tailwind.css`, compare the sorted set of `@custom-variant <name>` against `archive/shadcn-4.18.0-tailwind.css`; PASS on identical, else print the diff (a difference is a finding, not a failure of the script) |

Add a *Re-verify* section to `research/README.md`: `node research/verify.mjs`, what a FAIL means (a row to re-read, not a skill bug yet), and that it needs network. Leave the "Agents: stop here" header as the first thing in `README.md`.

**Done when.**
- `node research/verify.mjs` prints the version and 11 `PASS` lines on the current `latest`.
- Breaking one assertion on purpose (flip a `<` to `>`) turns exactly that line `FAIL` and the exit code to 1; revert.
- `research/README.md` documents it and the shadcn 4.21.0 result is recorded (item 8).

---

## 8. Provenance

Write `research/13-2026-09-14-audit-mechanics.md` with the standard header block (copy it from `12`), then sections: *What changed in the skill* (items 1–7, one paragraph each), *Compiles* (the `/[7%]` output, the `--check` fixture output, the shadcn diff command and result), *Eval runs* (item 5's cleanup result, item 6's three tables), *Verdicts* (did `paths` ship; did the cleanup eval pass first time).

Then:

- `research/CLAIMS.md`: add every row named above; in *Still soft*, leave the `group`/`peer` row as is. Rows cite section headings, not `file:line` (the README's *Anchor rot* note explains why).
- `research/README.md`: add `13` to *Live reports*; update *Known open* — the trigger rate is now measured in a real project and `paths` is tested (say which way it went); the `--spacing` trade-off row (item 4); add the *Re-verify* section (item 7). Mention `BRIEF-5.md` in the briefs list.
- `research/archive/briefs/BRIEF-5.md` (this file): prepend the one-line `> **Archive.**` blockquote the other briefs carry, pointing at `13`.
- `skills/tailwind/README.md`: layout tree (`evals/cleanup/`, `evals/run-trigger-eval.sh`, `research/verify.mjs`), the `--check` mode in *What it does*, the `${CLAUDE_SKILL_DIR}` sentence, the `paths` sentence if it shipped. Re-count the description length if you touched the description (you should not have: `09` showed wording is not the lever).
- Root `README.md`: touch only if it describes the tailwind skill's features in a way you changed (grep `oklch` and `cleanup` there first).

**Done when.**
- `claude plugin validate . --strict` passes.
- `git ls-files --eol skills/tailwind | grep -v 'i/lf'` is empty.
- `node scripts/oklch.mjs '#3b82f6'` → `oklch(0.623 0.188 259.815)`.
- `node research/verify.mjs` → all PASS.
- `node evals/cleanup/check.mjs evals/cleanup/expected evals/cleanup/expected/report.md` → pass.
- `grep -rn 'CLAUDE_SKILL_DIR' skills/tailwind/SKILL.md skills/tailwind/references/cleanup.md` shows every script invocation.
- Every sentence of fact you added to `SKILL.md` or `references/` has a `CLAIMS.md` row, and every row names a report section that contains the evidence.
- Your final report to the user lists, per item, done / blocked (with the exact command that blocked), and the three eval tables.
