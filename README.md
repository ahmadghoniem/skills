# skills

My Claude Code skills and CLI delegation plugins, in one repo and one marketplace.

Five standalone skills ship as the `kit` plugin. The `mngr` plugin drives three coding CLIs (`grok`, `agy`, `opencode`) and convenes them as a review council (`/mngr:council`).

Consolidated from seven separate repos: `align`, `tailwind-skill`, `delegate-to-opencode`, `snapshot-recall`, `claude-cursor-delegate`, `claude-grok-delegate` and `claude-agy-delegate`. Each file's history came with it, so `git log` and `git blame` still work back through the original commits.

## Install

Add the marketplace once, then install what you want:

```
/plugin marketplace add ahmadghoniem/skills
/plugin install kit@ahmadghoniem
/reload-plugins
```

The CLI plugin, council included:

```
/plugin install mngr@ahmadghoniem     # then /mngr:setup, which checks every CLI
```

To run from a checkout instead, point the marketplace at the directory:

```
/plugin marketplace add C:/path/to/skills
```

Installing still copies the plugin into `~/.claude/plugins/cache/`, so an edit in the checkout is not live. Pick it up with:

```
claude plugin marketplace update ahmadghoniem
claude plugin update kit    # and mngr
```

## Skills

### User-invoked

`disable-model-invocation: true`. The agent will not reach for these; you type them.

| Skill | What it does |
| --- | --- |
| [align-intent](./skills/align-intent/SKILL.md) | Reads the files behind a vague request, rephrases what it now understands, surfaces competing readings, and stops before editing. ([more](./skills/align-intent/README.md)) |
| [lean-claude](./skills/lean-claude/SKILL.md) | Measures what every Claude Code request carries (tools, skills, agents, MCP, instructions), joins it with how often your transcripts used each piece, and applies the cuts you pick. ([more](./skills/lean-claude/README.md)) |

### Model-invoked

Reachable by name, and the agent fires them when a task fits.

| Skill | What it does |
| --- | --- |
| [tailwind](./skills/tailwind/SKILL.md) | Tailwind v4 house style (semantic tokens, OKLCH, canonical syntax), plus a class-list cleanup pass. ([more](./skills/tailwind/README.md)) |
| [draft-post](./skills/draft-post/SKILL.md) | Reviews a draft for X against X's open-source ranking code (weights, filters, reply and slop labels, with file and line receipts) and tightens the copy. Checks the algorithm repo for new commits on each run and asks before updating its reference. |
| [recall](./skills/recall/SKILL.md) | Parses past Claude Code transcripts so the agent stops writing its own parser: `recent`, `grep`, `calls`, `show`, with a receipt on every hit. Stores nothing. |

## Delegation plugins

`/mngr:delegate <cli>` hands a task to an external CLI and `/mngr:setup [cli]` health-checks it. grok, agy and opencode run in a background Bash call and end with a session id that continues the work; Claude Code reports when they finish and TaskStop stops them. `/mngr:council` seats them as a review council.

| Plugin | What | Platform |
| --- | --- | --- |
| [mngr](./plugins/mngr/README.md) | [grok](./plugins/mngr/clis/grok/README.md) (Grok Build), [agy](./plugins/mngr/clis/agy/README.md) (Antigravity) and [opencode](./plugins/mngr/clis/opencode/README.md): delegate, setup, update, papercuts, and the [council](./plugins/mngr/council/README.md) | Windows |

mngr has one version; each CLI, and the council, keeps its own `CHANGELOG.md`.

## Layout

```
skills/<name>/SKILL.md   the skills; auto-discovered, no manifest list needed
plugins/<name>/          a whole Claude Code plugin, tests included
.claude-plugin/          marketplace.json + the skills bundle's plugin.json
```

Conventions live in [AGENTS.md](./AGENTS.md).

## License

MIT, one licence for the whole repo. See [LICENSE](./LICENSE).
