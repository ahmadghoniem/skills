> **Archive pointer.** Pair: [research-canonical-classes.md](research-canonical-classes.md), [research-upgrade-codemods.md](research-upgrade-codemods.md). Index: [README.md](README.md).

# Research: skills that enforce rules by running a CLI

**Question:** What is the established pattern for an Agent Skill that shells out to a deterministic tool (linter / formatter / bundled script) to verify or enforce its own rules, instead of only stating those rules in prose?

**Judgment lens:** a Tailwind v4 house-style skill that currently says things like “prefer a spacing-scale step over an arbitrary value like `[2px]`”, and a CLI/codemod that could detect/fix that mechanically.

**Sources (primary):** Anthropic `anthropics/skills`, Agent Skills spec (`agentskills.io`), Claude Code docs, Claude.ai how-to, Anthropic engineering post. Community: CyranoB/code-quality-skill, laurigates/claude-plugins, herbertjulio/specialist-agent.

---

## 1. Official position: why bundle executable code

Scripts are a first-class skill resource, not an afterthought. The canonical layout is:

```
skill-name/
├── SKILL.md          # required
├── scripts/          # optional: executable code
├── references/       # optional: docs loaded on demand
└── assets/           # optional: templates, icons, data
```

[agentskills.io/specification](https://agentskills.io/specification) · [github.com/anthropics/skills](https://github.com/anthropics/skills) · [claude.com/docs/skills/how-to](https://claude.com/docs/skills/how-to)

### Why (official wording)

**Determinism.** Anthropic engineering ([equipping-agents-for-the-real-world-with-agent-skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)):

> Large language models excel at many tasks, but certain operations are better suited for traditional code execution. […] many applications require the **deterministic reliability that only code can provide**.
>
> In our example, the PDF skill includes a pre-written Python script that reads a PDF and extracts all form fields. Claude can run this script **without loading either the script or the PDF into context**. And because **code is deterministic, this workflow is consistent and repeatable**.

**Token savings.** Platform docs ([platform.claude.com Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)):

> **Efficient script execution:** When Claude runs `validate_form.py`, the script's code **never loads into the context window**. Only its output (such as "Validation passed" or a specific error message) consumes tokens, which makes scripts far more efficient than having Claude generate equivalent code on the fly.

Progressive disclosure table from the same page: Level 3 resources (scripts) cost **nothing until accessed**; when run via bash, **only stdout/stderr enter context**.

**skill-creator** (`anthropics/skills` → `skills/skill-creator/SKILL.md`) is the authoring rulebook:

> **Scripts (`scripts/`)** — Executable code (Python/Bash/etc.) for tasks that require **deterministic reliability** or are repeatedly rewritten.
>
> - **When to include:** When the same code is being rewritten repeatedly or deterministic reliability is needed
> - **Example:** `scripts/rotate_pdf.py` for PDF rotation tasks
> - **Benefits:** Token efficient, deterministic, may be executed without loading into context
> - **Note:** Scripts may still need to be read by Claude for patching or environment-specific adjustments

And the bundling trigger, from the same skill:

> If all 3 test cases resulted in the subagent writing a `create_docx.py` or a `build_chart.py`, that's a **strong signal the skill should bundle that script**. Write it once, put it in `scripts/`, and tell the skill to use it. This saves every future invocation from reinventing the wheel.

**Complete Guide to Building Skills for Claude** (Anthropic PDF) is the most on-point quote for *enforcement*:

> For critical validations, consider bundling a script that performs the checks programmatically rather than relying on language instructions. **Code is deterministic; language interpretation isn't.** See the Office skills for examples of this pattern.

Claude.ai how-to is more conservative on *when*:

> **Start simple:** Begin with markdown instructions before adding scripts.

---

## 2. What `scripts/` looks like in practice

### Official Office skills (the production pattern)

`anthropics/skills` ships four source-available document skills whose scripts *are* the enforcement layer:

| Skill | `scripts/` (representative) | Role |
| --- | --- | --- |
| [pdf](https://github.com/anthropics/skills/tree/main/skills/pdf) | `check_fillable_fields`, `extract_form_field_info.py`, `fill_fillable_fields.py`, `extract_form_structure.py`, `check_bounding_boxes.py`, `convert_pdf_to_images.py` | Detect → extract JSON → fill → **verify boxes against images** |
| [xlsx](https://github.com/anthropics/skills/blob/main/skills/xlsx/SKILL.md) | `recalc.py`, `office/soffice.py` | Recalc formulas; JSON status; **gate shipping** |
| [pptx](https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md) | `thumbnail.py`, `add_slide.py`, `clean.py`, `office/validate.py`, `office/soffice.py` | Structural validate + visual QA via render |
| [docx](https://github.com/anthropics/skills/blob/main/skills/docx/SKILL.md) | `merge_runs.py`, `accept_changes.py`, `comment.py`, `office/validate.py`, `office/soffice.py` | Same: helper + validate + render-then-Read |

`init_skill.py` also scaffolds `scripts/example.py` (chmod 755) plus `references/` and `assets/`. Most real skills delete the example.

### Invocation syntax (this is the split)

**Agent Skills spec** ([using-scripts](https://agentskills.io/skill-creation/using-scripts)): relative paths from the **skill directory root**. Spec claims the agent runs commands from there.

Canonical instruction shape:

```markdown
## Available scripts

- **`scripts/validate.sh`** — Validates configuration files
- **`scripts/process.py`** — Processes input data

## Workflow

1. Run the validation script:
   ```bash
   bash scripts/validate.sh "$INPUT_FILE"
   ```

2. Process the results:
   ```bash
   python3 scripts/process.py --input results.json
   ```
```

**`anthropics/skills` Office skills** use that relative form, plus an explicit cwd note:

> Script paths below are relative to this skill's directory.

```bash
python scripts/recalc.py output.xlsx [timeout_seconds]
python scripts/office/validate.py deck.pptx
python scripts/thumbnail.py template.pptx template-thumbs
```

PDF `forms.md` is even more explicit:

> Run this script **from this file's directory:** `python scripts/check_fillable_fields <file.pdf>`

**Claude Code** is different. Session Bash cwd is the **project**, not the skill folder. Docs ([code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)):

> **Working directory:** Claude Code runs each command in the session shell's current working directory. […] Use `${CLAUDE_SKILL_DIR}` or `${CLAUDE_PROJECT_DIR}` in paths that must resolve the same way every time.

| Variable | Resolves to | Use |
| --- | --- | --- |
| `${CLAUDE_SKILL_DIR}` | Directory containing that skill's `SKILL.md` | Bundled scripts in this skill |
| `${CLAUDE_PLUGIN_ROOT}` | Plugin install dir (plugin skills only) | Shared plugin binaries |
| `${CLAUDE_PROJECT_DIR}` | Project root | Project-local scripts |

Claude Code substitution happens in **two places**: the skill body *and* `allowed-tools` Bash rules.

**Community fallback** when the host does not expand those vars (Cursor, Codex, etc.): name the skill dir, then use an absolute path. CyranoB/code-quality-skill:

```bash
bash <skill-dir>/scripts/detect-linter.sh [target-path]
# e.g. bash /Users/alice/.claude/skills/code-quality/scripts/detect-linter.sh [target-path]
```

laurigates uses the Claude Code var:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/configure-formatting.sh" --home-dir "$HOME" --project-dir "$(pwd)"
```

**Practical rule for a Cursor-hosted Tailwind skill:** do not assume `python scripts/foo.py` works from the user's project cwd. Either:

1. instruct `python "${CLAUDE_SKILL_DIR}/scripts/foo.py"` (Claude Code), or
2. instruct “resolve the directory containing this SKILL.md, then run `python <that>/scripts/foo.py`”, or
3. ship a zero-install wrapper the agent can `npx`/`uvx` from anywhere.

`--help` first, then invoke, never Read the source unless `--help` is insufficient. Official [webapp-testing](https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md):

> **Always run scripts with `--help` first** to see usage. DO NOT read the source until you try running the script first and find that a customized solution is absolutely necessary. These scripts can be very large and thus pollute your context window. They exist to be called directly as **black-box scripts** rather than ingested into your context window.

agentskills.io: `--help` is “the primary way an agent learns your script's interface.” Scripts must be **non-interactive** (no TTY prompts). Prefer JSON on stdout; the agent reads stdout/stderr to decide the next step.

---

## 3. Tool not installed — fallback wording

Three official patterns, in order of preference:

### A. Zero-install runners (spec recommendation)

Do not require a global install. Pin and fetch:

```bash
uvx ruff@0.8.0 check .
uvx black@24.10.0 .
npx eslint@9 --fix .
npx biome check .
```

[using-scripts](https://agentskills.io/skill-creation/using-scripts): “When an existing package already does what you need, you can reference it directly in your SKILL.md **without a `scripts/` directory**.”

Also: **state prerequisites** in the body (“Requires Node.js 18+”); for runtime-level needs use frontmatter:

```yaml
compatibility: Requires Python 3.14+ and uv
```

([spec `compatibility`](https://agentskills.io/specification) — optional, max 500 chars, “rarely needed” per skill-creator.)

### B. Preinstalled, install only on import failure (Office skills)

xlsx:

> `openpyxl`, `pandas`, and `markitdown` are **preinstalled — do not run `pip install` first**; write the script and import directly. **Only if an import fails** (or the `markitdown` command is missing): `pip install` the missing package.

pptx / docx: same for `require('pptxgenjs')` / `require('docx')` → `npm install` only if require fails.

### C. Optional tool, skip without dying

pdf SKILL.md: `### pdftk (if available)` — heading is the fallback. Do not make an optional binary a hard gate.

code-quality-skill:

> If `uvx` is absent, the section **skips with a warning rather than failing**.
>
> If `TOOL=none` and `LANGUAGE=unknown`, report that this project type is not supported yet.
>
> If `FALLBACK=true`, inform the user: “No linter config found in your project. Running with the skill's built-in defaults.”

herbertjulio `/lint`:

> **Never install linters** — Use what's already in the project.

**For a Tailwind house-style CLI:** prefer `npx`/`uvx` of a bundled or published checker, or a skill-local Python/Node script with PEP 723 / no extra deps. Do not `npm i -g`. If Node is missing, say so and stop — do not invent class-list edits from memory.

---

## 4. Run-then-interpret vs run-and-trust

**Never trust exit code alone. Parse output. Then edit. Then re-run.** This is the Office-skill loop, and it is the closest analog to “lint the class list.”

### xlsx `recalc.py` — the anti-trust-exit-code example

```bash
python scripts/recalc.py output.xlsx [timeout_seconds]   # default 30
```

Quoted instructions:

> **Zero formula errors.** Never ship while `recalc.py` reports `errors_found`.
>
> LibreOffice computes every formula, the file is rewritten in place, and you get JSON: `status` (`success` \| `errors_found`), `total_formulas`, `total_errors`, …
>
> **JSON with an `error` key instead of a `status` means nothing was recalculated**, and only that case exits non-zero — **`errors_found` exits 0, so never treat a clean exit as a clean workbook.**
>
> **A green recalc proves your formulas *evaluate*, not that they are *right*.** An off-by-one range […] yields a clean, error-free file with wrong numbers.

That last sentence is the house-style analog: a clean “no `[2px]`” scan does not prove the spacing is *right*.

### pptx — validate then look

> **After `writeFile()`, run `python scripts/office/validate.py deck.pptx`.** It reports the two chart faults above and the slide-XML defects PowerPoint refuses, **and names the fix for each.** Fix them in your generator, not by hand-editing the packed XML.

Then a second loop, Visual QA (judgment the CLI cannot do):

```bash
python scripts/office/soffice.py --headless --convert-to pdf output.pptx
rm -f slide-*.jpg
pdftoppm -jpeg -r 150 output.pdf slide
ls -1 "$PWD"/slide-*.jpg
```

> Convert the slides to images […] and **inspect every one**. After staring at the generating code you tend to see what you expect rather than what rendered, so look at the images fresh. […] **After fixes, rerun all four commands above.**

docx:

```bash
python scripts/office/soffice.py --headless --convert-to pdf output.docx
pdftoppm -jpeg -r 100 output.pdf page
ls page-*.jpg   # then Read the images
```

### pdf forms — branch on tool output, then verify

`forms.md`:

> first check […] Run […] `python scripts/check_fillable_fields <file.pdf>`, **and depending on the result** go to either the "Fillable fields" or "Non-fillable fields"
>
> then `python scripts/check_bounding_boxes.py fields.json`
>
> then `python scripts/convert_pdf_to_images.py <output.pdf> <verify_images/>`

### code-quality — parse JSON, distinguish findings vs failure

```bash
npx eslint --format json src/index.ts
npx @biomejs/biome check --reporter=json src/
ruff check --output-format json src/main.py
```

> Treat **exit code 1 as findings found**. Treat **exit code 2+ as config/runtime failure** and report it.
>
> Parse findings into file, line, column, rule, message, severity, and fixability.
>
> Complexity findings are **manual-only; do not mark them auto-fixable and do not offer `--fix` for them**.

knip skill (local, same pattern): run CLI → **triage known false-positive classes** → edit → **re-run** → typecheck. “without blindly trusting every result.”

**The loop, distilled:**

```
run tool → read stdout/JSON (not just exit) → classify
  (auto-fixable | needs judgment | false positive | tool failure)
→ edit only the first class, or apply --fix then re-run
→ re-run until clean or remaining items are documented exceptions
```

Do **not** “just run it and trust it” unless the tool is a pure formatter with no semantic exceptions (Prettier/Biome format). House-style spacing is not that — `[2px]` is often a bug and sometimes a correct hairline.

---

## 5. `allowed-tools` / Bash permission for the skill’s own script

**Yes, there is a convention. It is Claude Code–specific and experimental in the open spec.**

[Agent Skills spec](https://agentskills.io/specification):

```yaml
allowed-tools: Bash(git:*) Bash(jq:*) Read
```

> A space-separated string of tools that are pre-approved to run. **Experimental.** Support for this field may vary between agent implementations.

[Claude Code docs](https://code.claude.com/docs/en/skills) — the pattern that lets a bundled script skip the permission prompt:

```yaml
---
name: render-chart
description: Render a chart from a CSV file
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)
---

Run `${CLAUDE_SKILL_DIR}/scripts/render.sh <csv-file>` to render the chart.
```

> Using the same variable in both places lets a skill run a bundled script without a permission prompt. […] The `allowed-tools` rule then matches the exact command the skill body tells Claude to run.

Important limits (same page):

- Grant lasts **for the turn that invoked the skill**, then clears.
- It **does not restrict** other tools; it only pre-approves the listed ones.
- Plugin skills use `${CLAUDE_PLUGIN_ROOT}` the same way.
- Community skills often use a looser `allowed-tools: Read, Bash, Glob, Grep` (laurigates, herbertjulio) — wider than the spec example.

**Cursor:** there is no documented equivalent of `allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/… *)`. The agent still needs Shell approval unless the user has auto-approved it. Writing `allowed-tools` in frontmatter is harmless for spec compatibility and useful if the skill is later used in Claude Code; it will not by itself grant Cursor Shell.

---

## 6. Anti-patterns — when a script makes the skill worse

1. **Shipping a script before the prose loop is stable.** Official: “Start simple: Begin with markdown instructions before adding scripts.” A half-tested codemod that rewrites `p-[2px]` incorrectly is worse than a prose rule the model sometimes ignores.

2. **Loading the script into context.** webapp-testing exists specifically to stop this. If SKILL.md says “read `scripts/foo.py` and adapt it,” you pay the tokens you bundled the script to save. Instruct: run as a black box; Read only if `--help` fails.

3. **Relative `scripts/foo.py` with the wrong cwd.** Spec says skill root; Claude Code / Cursor Bash is project cwd. A skill that only writes `python scripts/recalc.py` will  “file not found” in Cursor unless you pin `${CLAUDE_SKILL_DIR}` or an absolute skill path.

4. **Trusting exit 0.** xlsx `recalc.py`: findings can exit 0. ESLint: 1 = findings, 2+ = crash. A Tailwind checker that prints violations but exits 0 will be skipped by a naive “if it failed, fix” instruction.

5. **Auto-fixing judgment rules.** code-quality: complexity is “manual-only; do not offer `--fix`.” knip: CSS-only and barrel false positives. House-style `[2px]` is this class: detect, don’t blindly rewrite.

6. **Duplicating a project tool badly.** agentskills.io: if `npx eslint` already does it, don’t wrap it. Wrap when the invocation is hard to get right, or when the *house* rule is not in the project linter. A Tailwind skill that shells `npx eslint` and hopes a plugin exists is weaker than a skill-bundled checker that encodes *this* house style.

7. **Interactive scripts / missing `--help`.** Hang the agent. Spec: no TTY prompts; flags/env/stdin only.

8. **Environment-specific binaries without a wrapper.** pptx: “bare `soffice` hangs in this sandbox” → they ship `scripts/office/soffice.py`. If your Tailwind CLI needs a native binary, wrap it or use `npx`.

9. **Scripts that still have to be patched per environment.** skill-creator note: “Scripts may still need to be read by Claude for patching.” If that’s the common path, you lost determinism *and* tokens.

10. **Security / surprise.** Anthropic: audit bundled scripts; don’t install untrusted skills. A skill that `--fix`s the user’s CSS without asking is a surprise.

11. **Prose and CLI that disagree.** If SKILL.md says “prefer scale step” and the script flags every arbitrary value including `w-[100dvh]`, the agent will thrash. The script’s findings taxonomy must match the prose exceptions.

---

## 7. Quotable SKILL.md examples (run a CLI to verify own rules)

### 1. xlsx — mandatory recalc, parse JSON, do not trust exit

Source: [skills/xlsx/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/xlsx/SKILL.md)

```markdown
## Recalculate (mandatory whenever the file contains formulas)

```bash
python scripts/recalc.py output.xlsx [timeout_seconds]   # default 30
```

Never ship while `recalc.py` reports `errors_found`.
`errors_found` exits 0, so never treat a clean exit as a clean workbook.
A green recalc proves your formulas *evaluate*, not that they are *right*.
```

### 2. pptx — after generate, validate; then render and Read

Source: [skills/pptx/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md)

```markdown
After `writeFile()`, run `python scripts/office/validate.py deck.pptx`.
It reports […] defects […] and names the fix for each.

## Visual QA
```bash
python scripts/office/soffice.py --headless --convert-to pdf output.pptx
pdftoppm -jpeg -r 150 output.pdf slide
ls -1 "$PWD"/slide-*.jpg
```
Inspect every image. After fixes, rerun all four commands above.
```

### 3. pdf forms — run detector, branch on output, then verify

Source: [skills/pdf/forms.md](https://github.com/anthropics/skills/blob/main/skills/pdf/forms.md)

```markdown
Run this script from this file's directory:
`python scripts/check_fillable_fields <file.pdf>`,
and depending on the result go to either "Fillable fields" or "Non-fillable fields".

`python scripts/check_bounding_boxes.py fields.json`
`python scripts/convert_pdf_to_images.py <output.pdf> <verify_images/>`
```

### 4. webapp-testing — black-box CLI, `--help` first, then inspect

Source: [skills/webapp-testing/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md)

```markdown
Always run scripts with `--help` first. DO NOT read the source until […] necessary.
These scripts […] exist to be called directly as black-box scripts.

```bash
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py
```

Reconnaissance-then-action: navigate → wait networkidle → screenshot/inspect DOM → then act.
```

### 5. Claude Code — pin path + pre-approve the skill’s own script

Source: [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)

```yaml
---
name: render-chart
description: Render a chart from a CSV file
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)
---

Run `${CLAUDE_SKILL_DIR}/scripts/render.sh <csv-file>` to render the chart.
```

### 6. Community linter wrap — detect, JSON, classify exit, don’t auto-fix judgment

Source: [CyranoB/code-quality-skill SKILL.md](https://github.com/CyranoB/code-quality-skill/blob/main/skills/code-quality/SKILL.md)

```markdown
bash <skill-dir>/scripts/detect-linter.sh [target-path]
# then
npx eslint --format json src/index.ts
ruff check --output-format json src/main.py

Treat exit code 1 as findings found. Treat exit code 2+ as config/runtime failure.
Complexity findings are manual-only; do not offer `--fix` for them.
```

laurigates formatting (parse structured script output, then act):

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/configure-formatting.sh" --home-dir "$HOME" --project-dir "$(pwd)"
```

> Parse `STATUS=` and the `ISSUES:` block from the output.

---

## 8. Implication for the Tailwind house-style skill

The established pattern is **not** “replace the prose with a CLI.” It is:

| Layer | Job | Analog |
| --- | --- | --- |
| SKILL.md prose | When to trigger; exceptions; judgment (`[2px]` as hairline vs slop) | pptx Visual QA checklist |
| `scripts/` (or `npx`/`uvx` one-off) | Deterministic scan: arbitrary values, raw colors, v3 patterns | `validate.py` / `recalc.py` / eslint `--format json` |
| Loop text | Run → parse JSON → classify → edit → re-run. Do not trust exit 0. Do not `--fix` judgment findings. | xlsx + code-quality |
| Path | `${CLAUDE_SKILL_DIR}/scripts/…` or “directory of this SKILL.md” | Claude Code vs Cursor |
| Missing tool | `npx`/`uvx`, or skip with a warning — never silently author from memory | using-scripts + code-quality |

**When to add the script:** after the prose rules are stable and you observe the model repeatedly missing the same mechanical class (arbitrary spacing, `dark:` on semantic tokens, v3 config). That is exactly skill-creator’s “subagents all independently wrote similar helper scripts” test.

**When not to:** if the only remaining errors need visual/semantic judgment the CLI cannot see (`p-0.5` vs `p-1` on a 2px hairline). Keep those as prose + a “report, don’t auto-fix” finding class.

---

## Source list

- https://github.com/anthropics/skills
- https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
- https://github.com/anthropics/skills/blob/main/skills/xlsx/SKILL.md
- https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md
- https://github.com/anthropics/skills/blob/main/skills/docx/SKILL.md
- https://github.com/anthropics/skills/blob/main/skills/pdf/forms.md
- https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md
- https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- https://claude.com/docs/skills/how-to
- https://code.claude.com/docs/en/skills
- https://agentskills.io/specification
- https://agentskills.io/skill-creation/using-scripts
- https://github.com/CyranoB/code-quality-skill
- https://github.com/laurigates/claude-plugins/blob/main/configure-plugin/skills/configure-formatting/SKILL.md
- https://github.com/herbertjulio/specialist-agent/blob/main/skills/lint/SKILL.md
- Anthropic, *The Complete Guide to Building Skills for Claude* (PDF): “Code is deterministic; language interpretation isn't.”
