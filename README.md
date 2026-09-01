# skills

My Claude Code skills and CLI delegation plugins, in one repo and one marketplace.

Five standalone skills ship as the `kit` plugin. Three delegation plugins (`cursor`, `grok`, `agy`) ship alongside them, each keeping its own commands, scripts and test suite.

Consolidated from seven separate repos: `align`, `tailwind-skill`, `delegate-to-opencode`, `snapshot-recall`, `claude-cursor-delegate`, `claude-grok-delegate` and `claude-agy-delegate`. Each file's history came with it, so `git log` and `git blame` still work back through the original commits.

## Install

Add the marketplace once, then install what you want:

```
/plugin marketplace add ahmadghoniem/skills
/plugin install kit@ahmadghoniem
/reload-plugins
```

The delegation plugins are separate installs, because each needs its own CLI on `PATH`:

```
/plugin install cursor@ahmadghoniem   # then /cursor:setup
/plugin install grok@ahmadghoniem     # then /grok:setup
/plugin install agy@ahmadghoniem      # then /agy:setup
```

To run from a checkout instead, point the marketplace at the directory:

```
/plugin marketplace add C:/path/to/skills
```

Installing still copies the plugin into `~/.claude/plugins/cache/`, so an edit in the checkout is not live. Pick it up with:

```
claude plugin marketplace update ahmadghoniem
claude plugin update kit    # and cursor, grok, agy
```

## Skills

### User-invoked

`disable-model-invocation: true`. The agent will not reach for these; you type them.

| Skill | What it does |
| --- | --- |
| [align](./skills/align/SKILL.md) | Reads the files behind a vague request, restates it in the repo's own names, labels what it assumed, and stops before editing. ([more](./skills/align/README.md)) |
| [snapshot](./skills/snapshot/SKILL.md) | Writes one brief of the current session to `%TEMP%`, for the next session to pick up. ([more](./skills/snapshot/README.md)) |
| [recall](./skills/recall/SKILL.md) | Orients the fresh session on the brief the last `/clear` injected. |

`snapshot` and `recall` are two halves of one loop: `/snapshot` → `/clear` → `/recall`. The `/clear` step needs a `SessionStart` hook, which the plugin cannot wire for you; see [skills/snapshot/README.md](./skills/snapshot/README.md).

### Model-invoked

Reachable by name, and the agent fires them when a task fits.

| Skill | What it does |
| --- | --- |
| [tailwind](./skills/tailwind/SKILL.md) | Tailwind v4 house style (semantic tokens, OKLCH, canonical syntax), plus a class-list cleanup pass. ([more](./skills/tailwind/README.md)) |
| [opencode](./skills/opencode/SKILL.md) | Translates an approved plan into opencode-ready tasks, picks from the live model list, runs opencode, verifies the result. |

## Delegation plugins

Same shape in all three: `/<name>:delegate` hands a task to an external CLI, `/<name>:result` prints what came back, `/<name>:resume` continues it, `/<name>:cancel` kills it, `/<name>:setup` health-checks the CLI.

| Plugin | CLI | Platform |
| --- | --- | --- |
| [cursor](./plugins/cursor/README.md) | `cursor-agent` (Composer) | Windows, Linux |
| [grok](./plugins/grok/README.md) | `grok` (Grok Build) | Windows |
| [agy](./plugins/agy/README.md) | `agy` (Antigravity) | Windows |

Each plugin keeps its own `CHANGELOG.md` and version number.

## Layout

```
skills/<name>/SKILL.md   the skills; auto-discovered, no manifest list needed
plugins/<name>/          a whole Claude Code plugin, tests included
.claude-plugin/          marketplace.json + the skills bundle's plugin.json
```

Conventions live in [AGENTS.md](./AGENTS.md).

## License

MIT, one licence for the whole repo. See [LICENSE](./LICENSE). `plugins/cursor/NOTICE` carries third-party attribution, which the licence does not replace.
