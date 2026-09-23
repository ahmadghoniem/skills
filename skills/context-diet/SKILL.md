---
name: context-diet
description: Measure what every Claude Code request carries, rank the cuts against real usage, and apply the ones the user approves.
argument-hint: "[--days N] [--calibrate]"
disable-model-invocation: true
---

Find what the user's Claude Code setup sends on every request that they don't use, and
cut it with their approval. Every request re-sends the system prompt, tool definitions,
skill and agent listings, MCP instructions and instruction files, so a component that
is never used still costs its tokens on every turn.

## 1. Measure

Run from the project the user works in (project `CLAUDE.md` and MCP config count):

```
node "${CLAUDE_SKILL_DIR}/scripts/diet.mjs" report --days 90 --json "<temp dir>/context-diet.json"
```

Pass on `$ARGUMENTS`. The probe is free: it points a headless `claude -p` at a local
server that records the first request and returns an error. `--calibrate` converts
characters to exact tokens with one real "say ok" request; offer it, since it uses a
little of the user's quota. Without it, 3.5 characters count as one token (within about
10% in practice).

The report gives the per-request total for interactive and headless sessions, the
switches not yet on and what each saves, and every tool, skill and agent with its
tokens, uses in the window and last use. Keep the JSON for step 4.

## 2. Recommend

Rank candidates by tokens saved per request, discounted by use. Something used last
week is not a candidate, however expensive. These rules come from measurement and are
not obvious:

- **Tools.** Only a bare name in `permissions.deny` (`"NotebookEdit"`) removes a tool
  from the request. Scoped rules (`"Agent(Explore)"`, `"Bash(rm:*)"`) save nothing.
  Denying a tool that is deferred (see the report's "Deferred tools" table) saves only
  its name in interactive sessions; rank those last. Never suggest denying `Bash`,
  `Read`, `Edit`, `Write`, `Glob`, `Grep` or `Skill`.
- **Skills.** A standalone skill with `disable-model-invocation: true` leaves the
  listing but still works as `/name`. Plugin skills leave only by disabling the plugin,
  so suggest that only when all of the plugin's skills, agents and tools are unused.
- **Agents.** Unused agents under `~/.claude/agents/` can be deleted or have their
  description shortened. Built-in agents come and go with switches (Explore/Plan) or the
  `Agent` tool itself.
- **MCP servers.** An unused server costs its tools and its instructions; suggest
  removing it or disabling its plugin.
- **Instruction files.** Report large `CLAUDE.md` and rules files with their size;
  suggest trimming but never edit them in this skill.
- **Switches the probe can't measure.** `awaySummaryEnabled: false` and
  `promptSuggestionEnabled: false` stop side requests that re-send the whole
  conversation (session recaps and next-prompt suggestions). Mention them with that
  reason and no token figure.

Present one table: change, tokens saved per request, evidence (uses, last used), and
what the user loses. Then ask which to apply (multi-select). Apply nothing unasked.

## 3. Apply

Edit only what was chosen:

- `~/.claude/settings.json`: read it first and keep every other key. Add bare names to
  `permissions.deny`, env switches to `env`, settings keys at the top level, and
  `"<plugin>@<marketplace>": false` under `enabledPlugins`.
- Skill frontmatter or agent files: edit in place.

Changes apply to new sessions. Changing the tool list inside a running session makes
the next request re-write the whole prompt cache, so tell the user to start a fresh
session rather than keep working in this one.

## 4. Verify

Re-run the report and show before and after: the per-request total and each applied
change's actual saving. If a change saved nothing, say so and offer to undo it.

## Limits

- The probe runs headless. Interactive sessions defer some tools; the report corrects
  for the ones the latest transcript lists as deferred.
- Usage comes from this machine's transcripts in `~/.claude/projects` (or
  `CLAUDE_CONFIG_DIR`). Sessions on other machines or in the cloud don't count.
- Built-in tool and prompt sizes change between Claude Code releases; re-run after
  updates rather than trusting old numbers.
