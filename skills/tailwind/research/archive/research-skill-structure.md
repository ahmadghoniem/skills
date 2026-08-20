> **Archive pointer.** Pair: [research-agent-skills-authoring.md](research-agent-skills-authoring.md). Process log of what changed: [after.md](after.md). Index: [README.md](README.md).

# How well-regarded Agent Skills are structured

Research only. Sources: official Anthropic skills + docs, skill-creator, and high-traction community repos. Measured 2026-08-18 from live GitHub files, not blog paraphrases.

Your current skill: `tailwind/SKILL.md` = **13,049 bytes, 100 lines, 1,935 words** (re-measured 2026-08-19, after the split proposed in §5 was applied — before it, the file was 16,003 bytes / 267 lines / 2,184 words and the problem was mixed *branches* in one load, not raw length). That is under Anthropic’s 500-line cap and still over the tighter community budgets used for house-style / always-on skills.

---

## 1. Standard file layout

Canonical tree, stated identically by the Agent Skills spec, Claude docs, and skill-creator:

```
skill-name/                 # must match YAML `name`
├── SKILL.md                # required, exact spelling
├── scripts/                # optional: executable code
├── references/             # optional: docs loaded on demand
└── assets/                 # optional: templates, fonts, icons used in output
```

- Spec: https://agentskills.io/specification
- Docs: https://claude.com/docs/skills/how-to
- skill-creator (official): https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
- Anthropic authoring guide: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices

### Names actually used in practice

| Dir / file | Who uses it | Role |
|---|---|---|
| `SKILL.md` | everyone | only required file |
| `scripts/` | pdf, pptx, docx, xlsx, mcp-builder, web-artifacts-builder, webapp-testing, skill-creator, vercel-optimize | run, don’t ingest |
| `references/` (plural) | skill-creator, spec, vercel-optimize, obra `using-superpowers` | on-demand docs |
| `reference/` (singular) | **official `mcp-builder`** | same job, different name |
| `assets/` | skill-creator (`eval_review.html`) | files copied into output |
| loose `forms.md`, `reference.md` at skill root | **official `pdf`** (the blog’s canonical example) | on-demand; not nested |
| `examples/` | official `internal-comms`, `webapp-testing` | mutually exclusive variants |
| `themes/` | official `theme-factory` | one file per variant |
| `templates/` | official `algorithmic-art`; alirezarezvani standard | copyable scaffolds |
| `rules/` | vercel-labs `react-best-practices`, `composition-patterns` | one markdown file per rule |
| `agents/` | skill-creator, almost all mattpocock/skills | subagent prompts, not user-facing refs |
| `LICENSE.txt` | most official skills | distribution, not loaded as instructions |

`pdf` (170k-star official repo) is the structure the engineering blog diagrams:

```
pdf/
├── SKILL.md          8,072 B   (loaded when triggered)
├── forms.md         11,854 B   (loaded only when filling forms)
├── reference.md     16,692 B   (advanced / JS / troubleshooting)
└── scripts/                    (fill, extract, validate — executed)
```

https://github.com/anthropics/skills/tree/main/skills/pdf

`mcp-builder` is the cleanest “workflow + domain split”:

```
mcp-builder/
├── SKILL.md                    9,092 B  (phases + pointers)
├── reference/
│   ├── mcp_best_practices.md
│   ├── node_mcp_server.md      28,550 B
│   ├── python_mcp_server.md    25,099 B
│   └── evaluation.md
└── scripts/                    evaluation helpers
```

https://github.com/anthropics/skills/tree/main/skills/mcp-builder

Vercel’s house-style analog (TOC in SKILL.md, one file per rule):

```
composition-patterns/
├── SKILL.md                    2,886 B  (when-to-apply + index)
├── AGENTS.md                   compiled dump (optional)
└── rules/
    ├── architecture-avoid-boolean-props.md
    ├── architecture-compound-components.md
    ├── patterns-explicit-variants.md
    └── …
```

https://github.com/vercel-labs/agent-skills/tree/main/skills/composition-patterns

---

## 2. What belongs where — the decision rule people actually use

**The rule is branching, not topic.** From Anthropic’s authoring guide and from `writing-for-agents` (mattpocock/skills, 221k stars):

> Inline what every branch needs. Push behind a pointer what only some branches reach.

| Goes in **SKILL.md body** | Goes in **`references/*.md`** (or root `forms.md`) | Goes in **`scripts/`** |
|---|---|---|
| The workflow / decision tree | Mutually exclusive domains (aws vs gcp; TS vs Python; form-fill vs merge) | Deterministic, repeated, error-prone ops |
| Rules that must fire on *every* use of the skill | Catalogs, API docs, long examples, schemas | Validation, init/scaffold, lint transforms |
| Pointers with **when to read** the rest | Anything >~100–300 lines of lookup | Black boxes: run via `--help`, do not `Read` |
| Tiny code patterns (<~50 lines) — obra | Variant data (one theme, one comms type) | |

Quotes:

skill-creator:

> `scripts/` — Executable code for deterministic/repetitive tasks  
> `references/` — Docs loaded into context as needed  
> `assets/` — Files used in output (templates, icons, fonts)

Anthropic engineering blog:

> By moving the form-filling instructions to a separate file (`forms.md`), the skill author is able to keep the core of the skill lean, trusting that Claude will read `forms.md` only when filling out a form.

https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills

obra/superpowers `writing-skills` (273k stars):

> **Separate files for:** (1) Heavy reference (100+ lines) — API docs, comprehensive syntax (2) Reusable tools — Scripts, utilities, templates  
> **Keep inline:** Principles and concepts, code patterns (< 50 lines), everything else.

https://github.com/obra/superpowers/blob/main/skills/writing-skills/SKILL.md

alirezarezvani Pattern 5 (24.6k stars, 345 skills):

> SKILL.md is the workflow. Reference docs are the knowledge base.  
> SKILL.md ≤10KB — if it's longer, move content to references.

https://github.com/alirezarezvani/claude-skills/blob/main/SKILL-AUTHORING-STANDARD.md

**Scripts vs read-as-docs** (must be explicit). Official `webapp-testing`:

> Always run scripts with `--help` first. DO NOT read the source until you try running the script first … These scripts can be very large and thus pollute your context window.

Anthropic best-practices:

> `"Run analyze_form.py to extract fields"` (execute) vs `"See analyze_form.py for the extraction algorithm"` (read).

If a cleanup rule is mechanical and unambiguous (`flex flex-row` → `flex`), the well-regarded move is a `scripts/` linter, not more prose. obra: “if it's enforceable with regex/validation, automate it — save documentation for judgment calls.”

---

## 3. How long is a typical SKILL.md?

Official numbers (contradictory on purpose — pick the budget that matches how often the skill loads):

| Source | Budget |
|---|---|
| skill-creator + platform best-practices | **< 500 lines** |
| agentskills spec / platform overview | **< 5,000 tokens** for the body |
| Anthropic “Complete Guide” PDF | keep SKILL.md **5,000 words** (looser) |
| Description field | 1,024 chars spec; Claude.ai **200 chars** |

https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices  
https://agentskills.io/specification

Measured `SKILL.md` in `anthropics/skills` (main, 19 skills):

| Skill | Bytes | Lines | Words | Extra files? |
|---|---:|---:|---:|---|
| `internal-comms` | 1,511 | 32 | 211 | `examples/*.md` router |
| `brand-guidelines` | 2,235 | 73 | 329 | none (all always-apply) |
| `web-artifacts-builder` | 3,087 | 73 | 446 | `scripts/init-artifact.sh` |
| `theme-factory` | 3,124 | 59 | 486 | `themes/*.md` |
| `webapp-testing` | 3,913 | 95 | 501 | `scripts/` + `examples/` |
| `docx` | 6,911 | 91 | 975 | `scripts/` |
| `pdf` | 8,072 | 314 | 1,007 | `forms.md` + `reference.md` |
| `frontend-design` | 8,260 | 55 | 1,336 | none (dense always-apply) |
| `mcp-builder` | 9,092 | 236 | 1,141 | `reference/` |
| `pptx` | 20,796 | 238 | 3,129 | `scripts/` (gotcha dump) |
| `skill-creator` | 33,168 | **485** | 5,205 | hits the 500-line cap; rest in `references/` + `agents/` |
| `claude-api` | 74,327 | — | — | outlier; rest of knowledge in lang dirs |

Community (live trees):

| Collection | Stars | SKILL.md sizes | Pattern |
|---|---:|---|---|
| [obra/superpowers](https://github.com/obra/superpowers) | 273k | n=14, min 2.3KB, **median 7.1KB**, max 32KB | keep inline unless heavy; they *aim* `<200–500 words` for frequently-loaded skills (stricter than they ship) |
| [mattpocock/skills](https://github.com/mattpocock/skills) | 221k | n=35, min 157 B, **median 3.6KB**, max 12KB | tiny SKILL.md + sibling `LOGIC.md` / `tests.md` / `agents/` |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | 30k | 1.2KB routers → 17KB workflow | TOC + `rules/` or `references/` |
| [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) | 25k | policy **≤10KB** | workflow in SKILL.md, knowledge in `references/` |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | 30k | list, not a skill tree | — |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | 73k | list, not a skill tree | — |

Closest always-on house-style analogs (do **not** split):

- official `frontend-design`: **8.3KB / 55 lines**, all principles in SKILL.md, no `references/`
- official `brand-guidelines`: **2.2KB**, colors+type inline
- vercel `web-design-guidelines`: **1.2KB** — SKILL.md is only a review *procedure*; rules are fetched
- Anthropic knowledge-work `design-system`: **5.6KB / 191 lines**, three modes (audit / document / extend) all in one file, no references. https://github.com/anthropics/knowledge-work-plugins/blob/main/design/skills/design-system/SKILL.md

**Your 13.1KB / 100 lines / 1,935 words** (post-split, 2026-08-19): legal under the 500-line rule; still fat versus house-style peers (2–8KB); still over alirezarezvani’s 10KB cap; ~4× obra’s “frequently-loaded <500 words” target.

---

## 4. Always-apply vs load-when-relevant — the actual mechanism

**Headings in SKILL.md do not disclose.** Once the skill triggers, the whole body is in context. Progressive disclosure is a *filesystem* mechanism, not a markdown-outline mechanism.

Three levels (same in the engineering blog, spec, and skill-creator):

| Level | What | When loaded | Cost |
|---|---|---|---|
| 1 | YAML `name` + `description` | every session, all installed skills | ~50–100 tokens/skill |
| 2 | SKILL.md body | when Claude decides the skill matches | whole file |
| 3 | bundled files | when SKILL.md tells Claude to read them | 0 until `Read` |

https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills  
https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview

The pointer is a **conditional instruction**, not a bare link. Real patterns:

**A. Conditional “if X, read Y”** — official `pdf/SKILL.md`:

> For advanced features, JavaScript libraries, and detailed examples, see REFERENCE.md. If you need to fill out a PDF form, read FORMS.md and follow its instructions.

**B. Router table** — official `internal-comms/SKILL.md` (1.5KB body, all variants outside):

> 2. **Load the appropriate guideline file** from the `examples/` directory:  
> `examples/3p-updates.md` / `company-newsletter.md` / `faq-answers.md` / `general-comms.md`

**C. Branch pick, then one file** — mattpocock `prototype/SKILL.md` (3.0KB):

> - “Does this logic / state model feel right?” → [LOGIC.md](LOGIC.md)  
> - “What should this look like?” → [UI.md](UI.md)

**D. Domain index + grep** — Anthropic best-practices Pattern 2:

```markdown
**Finance** → See reference/finance.md
**Sales** → See reference/sales.md
```

plus `grep -i "revenue" reference/finance.md` so Claude need not ingest the whole file.

**E. Harness-conditional** — obra `using-superpowers/SKILL.md`:

> If your harness appears here, read its reference file:  
> Codex: `references/codex-tools.md` …

**F. TOC of rule files** — vercel `react-best-practices/SKILL.md` (7.3KB index, 70 files under `rules/`):

> Read individual rule files … `rules/async-parallel.md`

**G. Execute, don’t load** — `webapp-testing` (quoted above).

What does **not** work: a `## Cleanup pass (on request)` heading inside SKILL.md. That section still loads on every Tailwind authoring turn.

Frontmatter `description` is level 1 only. Put **when to trigger** there; do not summarize the workflow (obra SDO: agents follow the description and skip the body).

---

## 5. Proposed tree for your five lumps

Your mix, mapped onto the branching test:

| Lump | Always needed on a Tailwind authoring turn? | Where it goes |
|---|---|---|
| (b) authoring rules (token ladder, `cn`, radius, `-px`) | **yes** | SKILL.md body |
| (c) anti-patterns that change *generation* (arbitrary hex, `dark:` pairs, `@apply` variants) | **yes, the short list** | SKILL.md, compact |
| (c) long v4 gotcha catalog (`h-dvh`, `@reference`/OOM, safelist, group/peer, …) | only when hitting that trap | `references/gotchas.md` |
| (a) project setup scaffold (`globals.css`, next-themes, vendored `dark:`) | only on greenfield / “set this up” | `references/setup.md` and/or `assets/globals.css` |
| (d) editor/linter (`classFunctions`, `no-arbitrary-value` CI) | only when configuring the editor | `references/editor.md` |
| (e) cleanup/refactor pass | only on “clean up / audit / simplify” | `references/cleanup.md` |

Do **not** split (b) from (c)-short. official `frontend-design` and `brand-guidelines` keep always-apply house style in SKILL.md. Pushing it to `references/` is how rules silently stop applying.

Do **not** make a second skill for cleanup. Cleanup needs the same token system; two skills either duplicate it or fail to load it. One skill, two modes, cleanup *detail* behind a pointer. (alirezarezvani Pattern 3: Mode 1 author / Mode 2 optimize. Anthropic `design-system`: audit | document | extend in one 5.6KB file — but their mode bodies are short. Yours aren’t, so the mode *bodies* leave SKILL.md.)

Concrete tree:

```
tailwind/
├── SKILL.md
│     YAML description: authoring + review + "clean up my tailwind" / "audit these classes"
│     Body (~2–4KB target):
│       1. Two jobs (author vs cleanup) — one paragraph
│       2. House style in brief (semantic tokens, dark via .dark, radius tokens)
│       3. Authoring ladder (the 4-step arbitrary-value walk) — always-on
│       4. Pointers with WHEN:
│          - New project / globals.css / next-themes / cn()
│            → read references/setup.md
│          - v4 trap (unknown utility, @apply, h-screen, dynamic class names, …)
│            → read references/gotchas.md
│          - IntelliSense inside cva/cn, or a lint rule
│            → read references/editor.md
│          - User asked to clean/audit/simplify, or review is clearly a class-list pass
│            → read references/cleanup.md and follow it
│       5. (optional later) "Run scripts/lint-classes.mjs --help" for mechanical auto-apply
│
├── references/
│   ├── setup.md          # (a) full globals.css, @theme inline, :root/.dark, next-themes, cn(), vendored dark:
│   ├── gotchas.md        # (c) long catalog; TOC at top (Anthropic: TOC if >100 lines)
│   ├── editor.md         # (d) classFunctions JSONC, experimental classRegex fallback, CI lint
│   └── cleanup.md        # (e) process, auto-apply list, candidates, never-touch, output format
│
└── assets/               # only if you want a copyable file rather than a fenced block
    └── globals.css       # paste-ready scaffold; SKILL.md says "copy assets/globals.css"
```

Optional later, only if the auto-apply list is stable:

```
└── scripts/
    └── lint-classes.mjs  # mechanical rewrites only; SKILL.md: run, don’t read
```

Do not create empty `scripts/` or `assets/` “for later.” Official skills omit unused dirs.

SKILL.md pointer wording to copy (pdf/internal-comms style, not a heading):

```markdown
## When to load more

- **Scaffolding a project** (no `globals.css` / no next-themes yet): read `references/setup.md` before writing CSS.
- **A v4 compile/runtime trap** (`@apply` variants, unknown utility in Vue/Svelte, `h-screen`, dynamic `bg-${x}`): read `references/gotchas.md`.
- **Editor autocomplete inside `cva`/`cn`**: read `references/editor.md`.
- **Cleanup / audit / simplify class lists** (user asked, or you are reviewing a component for class drift): read `references/cleanup.md` and follow its process and output format. Do not improvise a pass from memory.
```

Keep `references/cleanup.md` one level from SKILL.md (no `references/cleanup/auto-apply.md` nested behind it).

---

## 6. Patterns to avoid

From Anthropic best-practices, skill-creator, obra, and what the official repo actually does:

1. **Nested references.** `SKILL.md → advanced.md → details.md`. Claude `head`s nested files and misses the rest. *Keep references one level deep from SKILL.md.* https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices

2. **Orphan reference files.** A file with no WHEN-pointer in SKILL.md is never loaded. Every `references/*.md` needs a named condition in the body. `theme-factory` lists each theme *and* says “read the corresponding theme file.” `internal-comms` lists every example file.

3. **Over-splitting always-on rules.** If (b) authoring rules live in `references/authoring.md`, they will not apply on a normal “write this button” turn unless Claude happens to open the file. House-style peers keep this in SKILL.md (`frontend-design`, `brand-guidelines`).

4. **Using headings as disclosure.** `## Cleanup (on request)` still costs tokens every trigger. Disclosure = another file + a conditional read.

5. **Putting workflow in `description`.** obra SDO: agents execute the description and skip SKILL.md. Description = triggers only.

6. **`README.md` inside the skill folder.** Anthropic Complete Guide: “Don't include README.md inside your skill folder — all documentation goes in SKILL.md or references/.” (Repo-level README is fine.) Vercel skills *do* ship README.md + AGENTS.md; that is human packaging, not the Agent Skills contract.

7. **`@path/to/SKILL.md` force-links.** obra: `@` syntax force-loads and burns context. Use skill name + “read `references/foo.md` when …”.

8. **Asking Claude to `Read` large scripts.** `webapp-testing` forbids it. Scripts are black boxes.

9. **Windows paths.** Best-practices checklist: forward slashes only (`references/gotchas.md`).

10. **Generic filenames.** `docs/file1.md` vs `references/gotchas.md`. Agents navigate by name.

11. **Deep directory trees.** Spec allows extra dirs; discovery dies. `claude-api` (74KB SKILL.md + per-language trees) is the cautionary official example, not the template.

12. **Cookbook claim that “all .md files load when the skill loads.”** That contradicts the engineering blog and spec (level 3 is on-demand). Trust the blog + `pdf`/`internal-comms` behavior. https://platform.claude.com/cookbook/skills-notebooks-03-skills-custom-development is stale on this point.

13. **Splitting into two skills that share one token system.** You pay a second always-on `description` and risk the cleanup skill firing without house style (or both firing and duplicating). One skill, two modes.

14. **Empty `scripts/` / `assets/`.** Omit. skill-creator and spec mark them optional.

15. **Reference files >100–300 lines with no TOC.** Anthropic: TOC at top so a partial `head` still shows the map. skill-creator: TOC if `>300 lines`.

---

## Size target after the split

| File | Job | Ballpark (from peers) |
|---|---|---|
| `SKILL.md` | always-on house style + pointers | **2–8KB** (`brand-guidelines` 2.2, `frontend-design` 8.3, alirezarezvani cap 10) |
| `references/setup.md` | greenfield scaffold | whatever the CSS needs; not in the always-on budget |
| `references/gotchas.md` | lookup catalog + TOC | fine at 4–8KB |
| `references/editor.md` | one JSONC snippet | ~1KB |
| `references/cleanup.md` | full pass + output format | ~3–5KB (your current cleanup section is ~67 lines) |

You are not over the 500-line official cap today. You *are* mixing a 32-line always-on skill (`internal-comms` style router) with an 8KB house-style skill (`frontend-design`) with a 67-line review procedure (`web-design-guidelines`). The well-regarded split is: keep the house style, router the rest.

---

## Sources

Official

- https://github.com/anthropics/skills (170,188 stars) — measured all 19 `SKILL.md` files
- https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- https://claude.com/docs/skills/how-to
- https://agentskills.io/specification
- https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
- https://github.com/anthropics/knowledge-work-plugins (23,545 stars) — `design/skills/design-system`

Community (real trees, not awesome-list blurbs)

- https://github.com/obra/superpowers (273,483) — `skills/writing-skills/SKILL.md`, `using-superpowers/`
- https://github.com/mattpocock/skills (221,015) — `prototype/`, `tdd/`, `writing-for-agents/`
- https://github.com/vercel-labs/agent-skills (30,151) — `composition-patterns/`, `react-best-practices/`, `web-design-guidelines/`, `vercel-optimize/`
- https://github.com/alirezarezvani/claude-skills (24,609) — `SKILL-AUTHORING-STANDARD.md`

Awesome-lists checked and **not** used as layout evidence (they are indexes, not skill trees): ComposioHQ/awesome-claude-skills (72,716), VoltAgent/awesome-agent-skills (30,485), travisvn/awesome-claude-skills (14,700).
