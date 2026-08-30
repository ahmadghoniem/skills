> **Archive pointer.** Full spec checklist. Deltas against *this* skill: [../01-skill-best-practices.md](../01-skill-best-practices.md). Layout notes: [research-skill-structure.md](research-skill-structure.md). Index: [README.md](README.md).

# Agent Skills authoring best-practices checklist (2025–2026)

Research snapshot: **2026-08-18**. Primary sources fetched live. This file is a checklist of **checkable rules** with source URLs and authority. No evaluation of any particular skill.

**Authority legend**

| Label | Meaning |
|---|---|
| **Official (spec)** | [Agent Skills specification](https://agentskills.io/specification) (open standard, published by Anthropic Dec 18 2025) |
| **Official (Anthropic)** | Anthropic product/platform docs or engineering blog |
| **Official (Claude Code)** | [code.claude.com skills docs](https://code.claude.com/docs/en/skills) — includes spec fields plus Claude Code extensions |
| **Official (Cursor)** | [cursor.com/docs/skills](https://cursor.com/docs/skills.md) / [cursor.com/docs/context/skills](https://cursor.com/docs/context/skills) |
| **Official (Anthropic skill-creator)** | [anthropics/skills skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) |
| **Community** | High-traction community skill-authoring docs (e.g. obra/superpowers mirrors Anthropic’s guide; Cursor `/create-skill`) |

Where numbers conflict, both values are listed. Prefer the **spec** for portable skills; treat client extras as non-portable unless you are targeting that client only.

---

## 1. What a skill is

| # | Rule | Source | Authority |
|---|---|---|---|
| 1.1 | A skill is a **directory** containing, at minimum, a file named exactly `SKILL.md`. | [agentskills.io/specification](https://agentskills.io/specification) | Official (spec) |
| 1.2 | `SKILL.md` = YAML frontmatter + Markdown body. No body-format restrictions in the spec. | Same | Official (spec) |
| 1.3 | Optional conventional dirs: `scripts/` (executable), `references/` (on-demand docs), `assets/` (templates, images, data). Other files/dirs are allowed. | Same | Official (spec) |
| 1.4 | Discovery paths (cross-client): `.agents/skills/` (project), `~/.agents/skills/` (user). Client-specific: `.cursor/skills/`, `~/.cursor/skills/`, `.claude/skills/`, `~/.claude/skills/`, `.codex/skills/`, `~/.codex/skills/`. | [agentskills.io/skill.md](https://agentskills.io/skill.md); [Cursor skills](https://cursor.com/docs/skills.md); [Claude Code skills](https://code.claude.com/docs/en/skills) | Official (spec + clients) |
| 1.5 | Progressive disclosure has **three load levels**: (1) `name`+`description` always; (2) full `SKILL.md` body on activation; (3) bundled files only when referenced/needed. Scripts can execute without being loaded into context. | [spec § Progressive disclosure](https://agentskills.io/specification); [Anthropic overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview); [engineering blog, 2025-10-16](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) | Official (spec + Anthropic) |
| 1.6 | Treat a skill like an **onboarding guide**: table of contents first, chapters/appendix on demand. Bundled context is “effectively unbounded” because unread files cost zero tokens. | [engineering blog](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) | Official (Anthropic) |

---

## 2. Frontmatter: `name`

| # | Rule | Numbers / charset | Source | Authority |
|---|---|---|---|---|
| 2.1 | **Required** on spec, claude.ai uploads, Skills API, and `package_skill.py`. | — | [spec](https://agentskills.io/specification); [Claude Code “outside Claude Code” table](https://code.claude.com/docs/en/skills) | Official (spec) |
| 2.2 | Length: **1–64 characters**. | 64 max | Spec; [Anthropic best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices); [Claude overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) | Official (spec + Anthropic) |
| 2.3 | Charset: **unicode lowercase alphanumeric `a-z`, `0-9`, and hyphen `-` only**. | No uppercase, underscores, spaces | Spec `name` field | Official (spec) |
| 2.4 | Must **not** start or end with a hyphen. | Invalid: `-pdf`, `pdf-` | Spec | Official (spec) |
| 2.5 | Must **not** contain consecutive hyphens. | Invalid: `pdf--processing` | Spec | Official (spec) |
| 2.6 | Must **match the parent directory name**. | `name: pdf-processing` → dir `pdf-processing/` | Spec; [claude.com/docs/skills/how-to](https://claude.com/docs/skills/how-to); [Cursor](https://cursor.com/docs/skills.md) | Official (spec + Anthropic + Cursor) |
| 2.7 | Anthropic product extra: cannot contain **XML tags**. | — | [Anthropic best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices); [overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) | Official (Anthropic) — not in spec table |
| 2.8 | Anthropic product extra: cannot contain reserved words **`anthropic`** or **`claude`**. | Invalid: `anthropic-helper`, `claude-tools` | Same | Official (Anthropic) — not in spec table |
| 2.9 | Gerund form (`processing-pdfs`, `analyzing-spreadsheets`) is **recommended, not required**. Noun phrases (`pdf-processing`) and action-oriented (`process-pdfs`) are listed as acceptable. Avoid vague names: `helper`, `utils`, `tools`, `documents`, `data`, `files`. Keep naming **consistent across a skill collection**. | — | [Anthropic best practices — Naming conventions](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | Official (Anthropic) recommendation |
| 2.10 | Claude Code **divergence**: `name` is **optional**; display name defaults to directory name. For personal/project skills the slash-command is always the **directory name**, not frontmatter `name`. Plugin skills: frontmatter `name` can replace the last command segment. | — | [Claude Code frontmatter](https://code.claude.com/docs/en/skills) | Official (Claude Code) — **non-portable** |

---

## 3. Frontmatter: `description`

| # | Rule | Numbers | Source | Authority |
|---|---|---|---|---|
| 3.1 | **Required** (spec). Must be **non-empty**. | 1–**1024** characters (hard limit) | [spec](https://agentskills.io/specification) | Official (spec) |
| 3.2 | **Cannot contain XML tags** (Anthropic product validation). | — | [Anthropic best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | Official (Anthropic) |
| 3.3 | Must describe **both WHAT the skill does and WHEN to use it**. All “when to use” information belongs in the description, not only in the body. The description **carries the entire burden of triggering** (only metadata is loaded at startup). | — | Spec; [overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview); [optimizing descriptions](https://agentskills.io/skill-creation/optimizing-descriptions) | Official (spec + Anthropic) |
| 3.4 | Include **specific keywords / trigger terms** the user might say (file types, task names, domain words), including cases where the user does **not** name the domain. | — | Spec; Anthropic best practices; [skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) | Official |
| 3.5 | **Third person** (Anthropic): write as if describing the skill to another agent. Good: `"Processes Excel files and generates reports"`. Avoid first person (`"I can help you…"`) and second person (`"You can use this to…"`). Rationale: description is injected into the system prompt; POV mismatch hurts discovery. | — | [Anthropic best practices — Writing effective descriptions](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices); Cursor `/create-skill` | Official (Anthropic); Cursor community skill |
| 3.6 | **Imperative “Use when…”** (spec authoring guide): “Frame the description as an instruction to the agent: `Use this skill when...` rather than `This skill does...`.” Official Anthropic **examples** combine capability phrases with `Use when…`. | — | [agentskills.io optimizing-descriptions](https://agentskills.io/skill-creation/optimizing-descriptions); Anthropic PDF example | Official — **documented tension** with 3.5; both appear in first-party docs. Practical pattern in Anthropic’s own examples: capability clause (third-person/infinitive) + `Use when …` triggers. |
| 3.7 | Be **“pushy”** against under-trigger: list adjacent contexts, including “even if they don’t explicitly mention X.” | — | skill-creator; [optimizing-descriptions](https://agentskills.io/skill-creation/optimizing-descriptions) | Official (Anthropic skill-creator + spec site) |
| 3.8 | Length guidance (soft): “a few sentences to a short paragraph.” Spec hard cap remains 1024 chars. Metadata token budget ~**50–100 tokens per skill** at startup (see §6). | 1024 hard; ~50–100 tokens typical | Spec; [claude.com blog](https://claude.com/blog/building-agents-with-skills-equipping-agents-for-specialized-work) (~50 tokens); [overview table](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) (~100 tokens) | Official |
| 3.9 | **claude.ai upload extra:** descriptions limited to **200 characters** even though the spec allows 1024. | 200 chars on claude.ai | [claude.com/docs/skills/how-to](https://claude.com/docs/skills/how-to) | Official (Anthropic product) |
| 3.10 | Claude Code extra: combined `description` + `when_to_use` truncated at **1,536 characters** in the skill listing. If `description` is omitted, first markdown paragraph is used. | 1536 listing cap | [Claude Code](https://code.claude.com/docs/en/skills) | Official (Claude Code) — **non-portable** |
| 3.11 | Vague descriptions are called out as anti-patterns: `"Helps with PDFs."`, `"Processes data"`, `"Does stuff with files"`. | — | Spec; Anthropic best practices | Official |
| 3.12 | Agents often **won’t** consult a skill for trivial one-step tasks they can do natively even if the description matches. Descriptions should emphasize **specialized** knowledge/workflows. | — | [optimizing-descriptions](https://agentskills.io/skill-creation/optimizing-descriptions); skill-creator “How skill triggering works” | Official |
| 3.13 | Description eval method (optional but specified): ~**20** queries (8–10 should-trigger, 8–10 should-not, **near-misses** not obviously-irrelevant), run **3×**, pass if trigger rate **>0.5** (should) or **<0.5** (should-not); **60%/40%** train/validation; up to **5** revision iterations; pick best by **validation** score. | 20 queries, 3 runs, 0.5 threshold, 60/40 split, 5 iters | [optimizing-descriptions](https://agentskills.io/skill-creation/optimizing-descriptions); skill-creator | Official |

**Canonical Anthropic example (copy this shape):**

```yaml
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
```

Source: [overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) and spec.

---

## 4. Other frontmatter fields

### 4.1 Spec fields (portable)

| Field | Required | Constraints | Purpose | Source | Authority |
|---|---|---|---|---|---|
| `license` | No | Short string or bundled-file name | License applied to the skill | [spec](https://agentskills.io/specification) | Official (spec) |
| `compatibility` | No | **1–500 characters** if present; omit unless there are real env requirements | Intended product, packages, network, etc. | Spec | Official (spec) |
| `metadata` | No | Map of **string → string**; unique key names recommended | Client-specific extra props (`author`, `version`, …) | Spec | Official (spec) |
| `allowed-tools` | No | **Space-separated** string of pre-approved tools. **Experimental**; support varies. Example: `Bash(git:*) Bash(jq:*) Read` | Pre-approve tools | Spec | Official (spec) |

Spec-allowed properties for packaging/upload: **`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`**. Extra keys fail upload:

```
Unexpected key(s) in SKILL.md frontmatter: argument-hint. Allowed properties are: allowed-tools, compatibility, description, license, metadata, name
```

Source: [Claude Code](https://code.claude.com/docs/en/skills).

**Note:** [claude.com/docs/skills/how-to](https://claude.com/docs/skills/how-to) shows a `dependencies:` frontmatter example. That field is **not** in the spec’s allowed list. Treat as non-portable / possibly stale vs spec.

### 4.2 Claude Code extensions (non-portable)

| Field | Role | Source |
|---|---|---|
| `when_to_use` | Extra trigger text; counts toward 1,536 listing cap | [Claude Code](https://code.claude.com/docs/en/skills) |
| `disable-model-invocation` | `true` → user slash-command only; also blocks subagent preload and (v2.1.196+) scheduled-task auto-run | Same; also [Cursor](https://cursor.com/docs/skills.md) |
| `user-invocable` | `false` → Claude-only; hidden from `/` menu | Claude Code |
| `disallowed-tools` | Remove tools from pool for the invocation turn | Claude Code |
| `paths` (legacy `globs`) | Auto-invoke only when working files match globs | Claude Code; Cursor |
| `argument-hint`, `arguments` | Slash-command args | Claude Code |
| `model`, `effort`, `context`, `agent`, `background`, `hooks`, `shell` | Execution/runtime | Claude Code |

Cursor documents: `name`, `description`, `paths`, `disable-model-invocation`, `metadata`. Source: [cursor.com/docs/skills.md](https://cursor.com/docs/skills.md).

Cursor `/create-skill` **defaults** `disable-model-invocation: true` (user-invoked). That is a **Cursor skill-authoring convention**, opposite of Claude Code/spec default (`false` / model-invoked). Community (Cursor).

---

## 5. Size limits and token budgets

| # | Rule | Number | Source | Authority |
|---|---|---|---|---|
| 5.1 | Keep main `SKILL.md` **under 500 lines**. Split when approaching the limit. | **500 lines** (recommended, not a hard parser limit) | Spec; [Anthropic best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices); [how-to](https://claude.com/docs/skills/how-to); [Claude Code supporting files](https://code.claude.com/docs/en/skills); skill-creator | Official (spec + Anthropic + Claude Code) |
| 5.2 | Spec recommended body token budget: **&lt; 5,000 tokens** for instructions (Level 2). | **&lt; 5000 tokens** | [spec Progressive disclosure](https://agentskills.io/specification); [agentskills.io best-practices](https://agentskills.io/skill-creation/best-practices) (“under 500 lines and 5,000 tokens”) | Official (spec) |
| 5.3 | Level 1 metadata: **~100 tokens** per skill (overview table) **or ~50 tokens** (Claude blog) **or ~50–100 tokens** (agentskills.io/skill.md) **or ~100 words** (skill-creator). | ~50–100 tokens / ~100 words | [overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview); [blog](https://claude.com/blog/building-agents-with-skills-equipping-agents-for-specialized-work); spec site | Official — approximate, not enforced |
| 5.4 | Blog illustration (not a hard cap): full SKILL.md ~**500 tokens**, references **2,000+** when loaded. | ~500 / 2000+ | [claude.com blog](https://claude.com/blog/building-agents-with-skills-equipping-agents-for-specialized-work) | Official (Anthropic) — illustrative |
| 5.5 | Reference files: **unlimited** until read; no context penalty for unread files. | Unlimited until accessed | Spec; overview; engineering blog | Official |
| 5.6 | Reference files **longer than 100 lines** should include a **table of contents** at the top (partial-read / `head -100` safety). | **>100 lines → TOC** | [Anthropic best practices — Structure longer reference files](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | Official (Anthropic) |
| 5.7 | skill-creator variant: TOC for reference files **>300 lines**. | **>300 lines → TOC** | [skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) | Official (Anthropic skill-creator) — **stricter Anthropic docs say 100** |
| 5.8 | skill-creator: large docs **>300 lines** should move to `references/`. | **>300 lines → split out** | skill-creator quality checklist (via published skill) | Official (Anthropic skill-creator) |
| 5.9 | `description` **1024 chars**; `compatibility` **500 chars**; `name` **64 chars**. | See §2–4 | Spec | Official (spec) hard limits |
| 5.10 | Description optimization tends to **grow**; re-check 1024 before shipping. | 1024 | [optimizing-descriptions](https://agentskills.io/skill-creation/optimizing-descriptions) | Official (spec site) |

---

## 6. Progressive disclosure and reference files

| # | Rule | Source | Authority |
|---|---|---|---|
| 6.1 | `SKILL.md` is an **overview / table of contents** that points at detailed materials. | Anthropic best practices; engineering blog | Official (Anthropic) |
| 6.2 | **Keep references one level deep** from `SKILL.md`. Nested chains (`SKILL.md` → `advanced.md` → `details.md`) cause **partial reads** (`head -100`) and incomplete information. | [Anthropic best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices); spec “File references” | Official (spec + Anthropic) |
| 6.3 | Link with **relative paths from the skill root**, Markdown link syntax: `[the reference guide](references/REFERENCE.md)`. Also name scripts as `scripts/extract.py`. | Spec; Anthropic | Official |
| 6.4 | Pointers must say **when** to load, not just “see references/”. Example: `Read references/api-errors.md if the API returns a non-200 status code`. | [agentskills.io best-practices](https://agentskills.io/skill-creation/best-practices) | Official (spec site) |
| 6.5 | Keep **gotchas / edge cases that every run needs in SKILL.md**. A separate file only works if the agent will **recognize the trigger**; non-obvious traps should stay in the always-loaded body. | Same | Official (spec site) |
| 6.6 | Split by **mutually exclusive domains** so the agent loads one variant: `references/aws.md`, `gcp.md`, `azure.md`. | skill-creator; Anthropic “Pattern 2: Domain-specific organization” | Official |
| 6.7 | What stays in SKILL.md vs `references/`: core workflow + gotchas + short templates stay in; detailed API, long templates, troubleshooting move out. | [agentskills.io/skill.md decision table](https://agentskills.io/skill.md) | Official (spec site) |
| 6.8 | Name files **descriptively**: `form_validation_rules.md`, not `doc2.md`. Organize by domain: `reference/finance.md` not `docs/file1.md`. | Anthropic best practices “Runtime environment” | Official (Anthropic) |
| 6.9 | Conventional reference names in spec: `REFERENCE.md`, `FORMS.md`, domain files (`finance.md`). Official PDF skill uses **root-level** `reference.md` and `forms.md` (not necessarily under `references/`). | Spec; [engineering blog PDF example](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills); [anthropics/skills pdf](https://github.com/anthropics/skills) | Official — **`references/` is convention, not required** |
| 6.10 | Make execution vs read intent explicit: “Run `analyze_form.py`…” vs “See `analyze_form.py` for the algorithm.” | Anthropic best practices | Official |
| 6.11 | Observe real navigation: unexpected read order, missed links, overreliance (maybe inline that file), ignored files (maybe unused or poorly signaled). Iterate from observation. | Anthropic best practices; engineering blog | Official |
| 6.12 | If workflows become large, **push them into separate files** and tell the agent which to read based on the task. | Anthropic best practices (conditional workflow note) | Official |

---

## 7. Writing style

| # | Rule | Source | Authority |
|---|---|---|---|
| 7.1 | **Imperative** voice in the Markdown **body** (“Extract text…”, “Run this script…”). | skill-creator; Cursor `/create-skill` | Official (Anthropic skill-creator) + Cursor |
| 7.2 | Description: third person / “Use when…” — see 3.5–3.6. | Anthropic + spec site | Official |
| 7.3 | **Avoid time-sensitive info** in the main path (`If you're doing this before August 2025…`). Put legacy under **Current method** + **Old patterns** (optionally `<details>`). | [Anthropic best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | Official (Anthropic) |
| 7.4 | **One term throughout** (don’t mix “API endpoint” / “URL” / “route” / “path”). | Same | Official (Anthropic) |
| 7.5 | Prefer explaining **why** over heavy-handed MUST/NEVER. Yellow flag: ALL-CAPS ALWAYS/NEVER and over-rigid structures. Generalize beyond specific examples. | skill-creator “Writing Style” / “Improving the skill” | Official (Anthropic skill-creator) |
| 7.6 | **Favor procedures over instance-specific answers.** Teach how to approach a class of problems, not the join for one table. Specific constraints (“never output PII”) and templates are still valuable. | [agentskills.io best-practices](https://agentskills.io/skill-creation/best-practices) | Official (spec site) |
| 7.7 | **Aim for moderate detail.** Exhaustive edge-case catalogs hurt: the agent pursues inapplicable instructions. Concise stepwise guidance + a working example outperforms exhaustive docs. | Same | Official (spec site) |
| 7.8 | **Do not assume the skill is already installed / packages are present.** State install commands. Anti-pattern: “Use the pdf library…” Good: `pip install pypdf` then import. | Anthropic best practices “Avoid assuming tools are installed” | Official (Anthropic) |
| 7.9 | MCP tools: use **fully qualified** `ServerName:tool_name`. | Anthropic best practices | Official (Anthropic) |

---

## 8. Content: what belongs in a skill

| # | Rule | Source | Authority |
|---|---|---|---|
| 8.1 | **Default assumption: the model is already smart.** Only add what it does **not** already know. Challenge every paragraph: “Does this justify its token cost?” | Anthropic best practices “Concise is key”; [agentskills.io best-practices](https://agentskills.io/skill-creation/best-practices) | Official |
| 8.2 | Include: project-specific conventions, non-obvious edge cases, **which** tool/API to use, organizational procedures. Omit: what a PDF is, how HTTP works, how libraries work in general. | Same | Official |
| 8.3 | Test: **“Would the agent get this wrong without this instruction?”** If no, cut. If the agent already handles the whole task well, the skill may add no value. | agentskills.io best-practices | Official (spec site) |
| 8.4 | Ground skills in **real expertise**, not LLM-generic “best practices.” Extract from a completed task (steps that worked, corrections, I/O, unknown context) or from internal runbooks/schemas/review comments/incident reports. | Same | Official (spec site) |
| 8.5 | **One skill = one coherent unit of work** (like a function). Too narrow → many skills load and conflict. Too broad → imprecise activation. Separate skills for different workflows compose better than one mega-skill. | agentskills.io best-practices; [how-to](https://claude.com/docs/skills/how-to) | Official |
| 8.6 | **Start with evaluation, then write the minimum** that closes observed gaps — not imagined requirements. Identify gaps without a skill → 3 eval scenarios → baseline → minimal instructions → iterate. | Anthropic best practices; engineering blog | Official (Anthropic) |
| 8.7 | **Examples beat explanations** for output style: concrete input/output pairs. “Examples are concrete, not abstract” is on the official checklist. | Anthropic best practices | Official |
| 8.8 | **Degrees of freedom** — match specificity to fragility: | Anthropic best practices; agentskills.io “Calibrating control” | Official |
| | **High** (text heuristics): many valid approaches (code review). | | |
| | **Medium** (templates/pseudocode): preferred pattern, some variation. | | |
| | **Low** (exact scripts, “Do not modify the command”): fragile / consistency-critical. | | |
| 8.9 | **Provide a default + escape hatch**, not a menu of equals. | Anthropic anti-patterns; agentskills.io | Official |
| 8.10 | Patterns to use when they fit: output **templates**; **checklists** for multi-step work; **validation loops**; **plan-validate-execute** for batch/destructive ops; **conditional workflows**. | Anthropic best practices; agentskills.io | Official |
| 8.11 | **Gotchas** are often highest-value: environment facts that **defy reasonable assumptions**. Keep them in SKILL.md. When you correct a mistake, add it to gotchas. | agentskills.io best-practices | Official (spec site) |
| 8.12 | Bundle a **script** when traces show the agent reinventing the same logic every run. Scripts: self-contained, good errors, **no interactive TTY prompts**, `--help`, declare deps (PEP 723 / `compatibility`). | skill-creator; agentskills.io/skill.md; Anthropic | Official |
| 8.13 | **Do not hardcode secrets.** Audit downloaded skills. Skills that fetch untrusted URLs are high risk. | [how-to security](https://claude.com/docs/skills/how-to); [overview security](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview); engineering blog | Official |
| 8.14 | **Lack of surprise:** contents must match described intent; no malware / unauthorized-access skills. | skill-creator | Official (Anthropic) |

---

## 9. Official anti-patterns

| # | Anti-pattern | Correction | Source | Authority |
|---|---|---|---|---|
| 9.1 | **Windows-style paths** (`scripts\helper.py`) | Forward slashes only: `scripts/helper.py` | Anthropic best practices | Official (Anthropic) |
| 9.2 | **Deeply nested references** | All refs linked **directly** from SKILL.md | Anthropic + spec | Official |
| 9.3 | **Vague descriptions** | WHAT + WHEN + trigger keywords | Spec + Anthropic | Official |
| 9.4 | **Assuming packages/tools are installed** | Explicit install + import | Anthropic | Official |
| 9.5 | **Too many choices** | Default + one escape hatch | Anthropic + spec site | Official |
| 9.6 | **Time-sensitive main-path instructions** | Current vs Old patterns | Anthropic | Official |
| 9.7 | **Inconsistent terminology** | Pick one term | Anthropic | Official |
| 9.8 | **Vague skill names** (`helper`, `utils`) | Gerund or specific noun phrase | Anthropic | Official |
| 9.9 | **Explaining knowledge the model already has** | Cut; keep house rules / judgment calls | Anthropic “Concise is key” | Official |
| 9.10 | **Offering equal options without a default** | Same as 9.5 | Anthropic | Official |
| 9.11 | **Scripts that punt errors to the model** / voodoo constants | Handle errors; justify numbers | Anthropic | Official |
| 9.12 | **Generic LLM-written skills** without domain artifacts | Feed real runbooks/tasks | agentskills.io best-practices | Official (spec site) |
| 9.13 | **Vague instructions** (“Handle errors appropriately”) | Specific retry/status rules | agentskills.io/skill.md gotchas | Official (spec site) |
| 9.14 | **Too-comprehensive / encyclopedic skills** | Progressive disclosure + moderate detail | agentskills.io | Official (spec site) |
| 9.15 | **Interactive scripts** (TTY/password prompts) | Flags / env / stdin only | agentskills.io/skill.md | Official (spec site) |
| 9.16 | **Poor script errors** (“invalid input”) | Actionable expected-vs-got messages | Same | Official (spec site) |
| 9.17 | **`name` ≠ directory**; `--` or leading/trailing `-` | Exact match, charset rules | Spec | Official (spec) |
| 9.18 | **Description that only says what, not when** | Add `Use when…` and contexts | Spec site | Official |
| 9.19 | **Overfitting description to eval keywords** | Generalize concepts; use val split | optimizing-descriptions | Official |
| 9.20 | **Triggering on trivial native tasks** | Emphasize specialized need | optimizing-descriptions | Official |
| 9.21 | **Unqualified MCP tool names** | `Server:tool` | Anthropic | Official |
| 9.22 | **Extra frontmatter keys** on claude.ai / API / `package_skill.py` | Only the six spec fields | Claude Code | Official (Anthropic packaging) |
| 9.23 | **ZIP layout** with SKILL.md at zip root | Zip must contain `skill-name/SKILL.md` | [how-to](https://claude.com/docs/skills/how-to) | Official (Anthropic) |

obra/superpowers `writing-skills/anthropic-best-practices.md` is a **verbatim/near-verbatim mirror** of Anthropic’s platform best-practices page (same 500-line, 1024-char, 64-char, one-level-deep, Windows-path, TOC rules). Treat as **community republication of official Anthropic**, not an independent standard: https://github.com/obra/superpowers/blob/main/skills/writing-skills/anthropic-best-practices.md

---

## 10. Bundled-file naming conventions

| Convention | Who | Notes |
|---|---|---|
| `scripts/`, `references/`, `assets/` | Spec | Recommended, not mandatory |
| `REFERENCE.md`, `FORMS.md` in `references/` | Spec examples | |
| Root-level `reference.md`, `forms.md`, `examples.md` | Anthropic PDF skill + best-practices diagrams | Equally official |
| `reference/` (singular) | Official `mcp-builder` skill | Same job as `references/` |
| Descriptive kebab or snake names matching content | Anthropic runtime guidance | `form_validation_rules.md` |
| `LICENSE.txt` | Common in anthropics/skills | Pair with `license:` frontmatter |
| `evals/evals.json` | skill-creator | Testing, not runtime |

---

## 11. Official checklists (verbatim themes)

### Anthropic “Checklist for effective Skills”

Source: [platform.claude.com …/best-practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

**Core quality**

- [ ] Description is specific and includes key terms
- [ ] Description includes both what the Skill does and when to use it
- [ ] SKILL.md body is under 500 lines
- [ ] Additional details are in separate files (if needed)
- [ ] No time-sensitive information (or in “old patterns” section)
- [ ] Consistent terminology throughout
- [ ] Examples are concrete, not abstract
- [ ] File references are one level deep
- [ ] Progressive disclosure used appropriately
- [ ] Workflows have clear steps

**Code and scripts**

- [ ] Scripts solve problems rather than defer to Claude
- [ ] Error handling is explicit and helpful
- [ ] No “voodoo constants”
- [ ] Required packages listed and verified
- [ ] Scripts have clear documentation
- [ ] No Windows-style paths
- [ ] Validation/verification for critical operations
- [ ] Feedback loops for quality-critical tasks

**Testing**

- [ ] At least **three** evaluations
- [ ] Tested with Haiku, Sonnet, and Opus (if those are target models)
- [ ] Tested with real usage scenarios

### agentskills.io verification checklist (extra items)

Source: [agentskills.io/skill.md](https://agentskills.io/skill.md)

- [ ] `name` 1–64, charset, matches directory, no leading/trailing/consecutive hyphens
- [ ] `description` 1–1024, WHAT + WHEN, imperative “Use when…”, specific contexts
- [ ] Instructions focus on what the agent would **not** know
- [ ] Gotchas for environment facts that defy assumptions
- [ ] Scripts: deps documented, no interactive prompts, helpful errors, relative to skill root, `--help`
- [ ] SKILL.md &lt; 500 lines; detail in `references/`
- [ ] 2–3 realistic test cases; trigger evals; with-skill beats without-skill

### skill-creator extras

- [ ] Instructions in **imperative** form
- [ ] Explains **why**, not just what
- [ ] Clear navigation to references
- [ ] Output formats defined explicitly
- [ ] Large docs &gt;300 lines moved to `references/`
- [ ] License if distributing
- [ ] Negative triggers in description if relevant

---

## 12. Conflicting numbers (use this table when auditing)

| Topic | Value A | Value B | Resolution for portable skills |
|---|---|---|---|
| Description length | Spec **1024** | claude.ai **200** | 1024 for files; 200 if uploading to claude.ai |
| Description listing (Claude Code) | Spec 1024 | Claude Code truncates listing at **1536** (`description`+`when_to_use`) | Keep ≤1024 for portability |
| Metadata tokens | ~50 / ~100 / ~100 words | Approximate | Keep description short anyway |
| SKILL.md size | **500 lines** + **5000 tokens** (spec) | skill-creator “&lt;500 lines ideal”, “feel free to go longer”; blog ~500 tokens as illustration | Treat 500 lines / 5k tokens as the official recommended budget |
| Reference TOC | Anthropic docs **>100 lines** | skill-creator **>300 lines** | Prefer **>100 lines → TOC** (stricter Anthropic authoring guide) |
| Split to references | Approaching 500-line SKILL.md | skill-creator **>300 line** docs | Split SKILL.md before 500; split fat references at ~300 or whenever only some branches need them |
| `name` required | Spec yes | Claude Code optional | Required for portable skills |
| `allowed-tools` format | Spec: **space-separated** | Claude Code: space, comma, **or YAML list** | Space-separated for portability |
| Description POV | Anthropic: **third person** | spec site: **imperative “Use when”** | Combine: third-person/infinitive WHAT + `Use when` WHEN (matches Anthropic’s published examples) |
| Default invocation | Spec/Claude: model-invoked | Cursor `/create-skill`: `disable-model-invocation: true` | Choose per product; portable default is model-invoked with a good description |

---

## Sources

### Official specification
- https://agentskills.io/specification
- https://agentskills.io/skill.md
- https://agentskills.io/skill-creation/best-practices
- https://agentskills.io/skill-creation/optimizing-descriptions
- https://agentskills.io/llms.txt

### Anthropic
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- https://claude.com/docs/skills/how-to
- https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills (2025-10-16)
- https://claude.com/blog/building-agents-with-skills-equipping-agents-for-specialized-work
- https://www.anthropic.com/news/skills
- https://github.com/anthropics/skills (incl. `skills/skill-creator/SKILL.md`)
- https://code.claude.com/docs/en/skills

### Cursor
- https://cursor.com/docs/skills.md
- https://cursor.com/docs/context/skills
- Cursor built-in `/create-skill` (mirrors Anthropic authoring guide + Cursor fields `disable-model-invocation`, 64/1024 limits)

### Community republication of Anthropic
- https://github.com/obra/superpowers/blob/main/skills/writing-skills/anthropic-best-practices.md
