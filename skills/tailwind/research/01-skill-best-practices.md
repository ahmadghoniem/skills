> **Provenance:** **live** for packaging deltas vs this skill. Full checklist: `archive/research-agent-skills-authoring.md`. Index: [README.md](README.md). Claims: [CLAIMS.md](CLAIMS.md).

# Task 1 — Skill-authoring best practices (deltas only)

Checked against current Agent Skills spec, Claude Code skills docs, and Anthropic’s skill-authoring best practices (2026). This skill already conforms on the load-bearing bits. No frontmatter or layout rewrite is required.

## What would change the skill

Nothing required. Optional only if you later publish to Claude.ai / the Skills API:

- The open spec still requires `name` + `description`; `license` remains optional. `allowed-tools` and `metadata` are optional, not newly required. Claude Code treats almost all fields as optional and recommends `description`. Do not add `allowed-tools` unless you want a one-turn permission grant.
- `compatibility` exists (max 500 chars) and is unused here. Skip it — this skill has no special environment.
- Claude.ai still caps `description` at **200 characters**. The spec allows **1024**. This skill’s description is ~280 chars: fine for Claude Code / Cursor, too long for a claude.ai upload. Truncation of `description` + `when_to_use` at **1,536 characters** is a listing UI limit, not a SKILL.md hard fail.
- `evals/` is **not** part of the Agent Skills directory convention (`scripts/`, `references/`, `assets/`). It is a skill-creator / eval-harness convention. Do not add it unless you start running evals.

## Already conforms (one line)

Frontmatter (`name`, `description`, `license`), third-person description with triggers, `references/` split, SKILL.md well under 500 lines, directory name matching `name: tailwind`, and progressive-disclosure pointers all match current published guidance.

## Sources

- https://agentskills.io/specification
- https://code.claude.com/docs/en/skills
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- https://claude.com/docs/skills/how-to
