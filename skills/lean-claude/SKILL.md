---
name: lean-claude
description: Measure the tokens every Claude Code request carries before the user types anything, match each piece against real usage, and cut the unused ones the user picks.
argument-hint: "[--days N]"
disable-model-invocation: true
---

Every request re-sends the system prompt, tool definitions, skill and agent listings,
MCP instructions and instruction files. A piece that is never used still costs its
tokens on every turn. Find those pieces, explain each one, and cut the ones the user
picks. Whenever you mention something that can be cut, give its token cost.

## 1. Measure

Run from the project the user works in (its `CLAUDE.md` and MCP config count):

```
node "${CLAUDE_SKILL_DIR}/scripts/lean.mjs" report --days 90 --json "<temp dir>/lean-claude.json"
```

Pass `$ARGUMENTS` through. Tell the user it takes about a minute and uses none of their
usage limits:
- The request is captured by a local server that answers with an error, so no model runs.
- Tokens are counted by Anthropic's free `count_tokens` endpoint with the user's own login.
- If counting fails, the report says "estimate" and figures are within about 10%.

Keep the JSON; step 5 compares against it.

## 2. Show where the tokens go

Open with the per-request total for interactive sessions and the three largest kinds.
One short paragraph, no tables yet.

## 3. Pick the candidates

Take candidates from the JSON. Something used in the last two weeks is not a candidate,
however expensive; show its usage and let the user decide. Order each group by tokens.

**Tools and switches**
- **Artifact** (`enableArtifact: false`) removes Artifact plus ArtifactComments and
  ArtifactData, together the largest item on most setups. It publishes pages to
  claude.ai. Without it, Claude writes a local HTML file instead.
- **PowerShell** (Windows only, `CLAUDE_CODE_USE_POWERSHELL_TOOL=0`). A second shell next
  to Bash. With Git Bash installed, Bash covers the same work and calls
  `powershell.exe -Command` for Windows-only queries, and two shells make the model pick
  one on every command. Recommend the switch whenever Git Bash is present, even if the
  tool was used: its uses were work Bash can do.
- **Cron tools** (`CLAUDE_CODE_DISABLE_CRON=1`). They schedule a prompt inside the
  session ("remind me at 2:30", "run the tests every 10 minutes"); a job fires only
  while Claude is idle and ends with the session. `/loop` stops working.
- **Other unused tools**: a bare name in `permissions.deny` (`"NotebookEdit"`). Scoped
  rules (`"Bash(rm:*)"`) remove nothing. Explain what the tool does in one line:
  - `RemoteTrigger` manages claude.ai routines, sessions that run in the cloud on a
    schedule or on a GitHub event.
  - `PushNotification` sends a desktop notification, and to the phone while Remote
    Control is connected. Its description is the same size either way, so a user with
    `disableRemoteControl: true` pays for phone text they cannot use.
  - `ListAgents` is needed only to message other sessions by name. Put it as: "only for
    messaging sessions by name; N calls in 90 days; subagents you spawn work without it".
  - `DesignSync` syncs a component library with a claude.ai/design project.
- Rank deferred tools last: interactive sessions send only their names.
- Never suggest denying `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Skill` or
  `ToolSearch`.

**Skills and plugins**
- Explain the two kinds of skill first. A skill is either model-invoked (listed to the
  model, which may load it on its own) or user-invoked (typed as `/name`). Many users
  don't know a skill can be both, or only the second.
- **Typed, never model-invoked** (`typed > 0`, `modelUses` 0): `skillOverrides`
  `"user-invocable-only"`. It leaves the model's listing but `/name` still works. This
  works on built-in skills too (`claude-api`, `code-review`, `init`, …).
- **Never used**: `skillOverrides` `"off"`.
- **claude.ai skills** (`syncClaudeAiSkills: false`). Skills enabled in the user's
  claude.ai account sync into Claude Code: Anthropic's docx, pptx, xlsx and pdf skills
  when file creation is on there, plus any the user added. Each is instructions and
  helper scripts, not a tool. Without them Claude can still make these files but writes
  its own script instead of following a tested recipe.
- **Plugins**: a plugin's skills leave the listing only when the whole plugin is
  disabled (`enabledPlugins`, `"<plugin>@<marketplace>": false`). Suggest that only when
  every part of it (skills, agents, MCP tools) went unused.
- **MCP servers and claude.ai connectors**: an unused server costs its tools and its
  instructions. `disableClaudeAiConnectors: true` removes all claude.ai connectors.
- **Agents**: only files under `~/.claude/agents/` (`userFile: true`) can be deleted.

**Prompt switches**
- **Short system prompt** (`CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1`), usually the largest
  switch. It keeps the "confirm before hard-to-reverse actions" guidance. It drops the
  full prompt's guidance on scope and code style: don't add features or abstractions
  beyond the task, no error handling for cases that can't happen, default to no
  comments, watch for injection and XSS, test UI changes in a browser, answer
  exploratory questions briefly before implementing, make independent tool calls in
  parallel. It also shortens tool descriptions and the built-in git instructions (to
  about 110 tokens). Say it is the one cut that can change behaviour, and offer a short
  `~/.claude/rules/` file with the dropped lines the user wants back (about 200 tokens).
- **Explore/Plan agents** (`CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1`). If they were
  spawned, explain: Explore is a read-only search agent, Plan does plan-mode research,
  and Explore now runs on the main model, so it saves nothing over general-purpose. The
  user can ask their agent to write a read-only agent on a cheaper model instead. If
  never spawned, one line.

**Background requests**: always suggest the ones that are off, whatever the usage.
Each re-sends the whole conversation as a side request, which counts against usage;
the probe cannot measure them.
- `awaySummaryEnabled: false`: the recap written when the terminal loses focus.
  `/recap` still works on demand.
- `promptSuggestionEnabled: false`: the greyed-out next-prompt suggestion.

**Do not suggest** `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`. It saves little more than
`user-invocable-only` and makes every bundled command untypable. Mention it only if
the user asks.

Report large `CLAUDE.md` and rules files with their size. Never edit them here.

## 4. Ask, then apply

Ask with AskUserQuestion, one multi-select question per group: Tools, Skills and
plugins, Prompt switches, Background requests. Skip empty groups. Each option:
- label: the change and its saving, `Artifact (−14,152)`
- description: uses in the window and last use, then what the user loses

A question takes at most 4 options. With more candidates, ask the top 4 and list the
rest under the question in your message; the user can pick them through "Other".

Apply only what was picked:
- `~/.claude/settings.json`: read it first and keep every other key. Bare names go in
  `permissions.deny`, env switches in `env`, other keys at the top level.
- Skill frontmatter and agent files: edit in place.

Changes apply from the next session. Deny rules also apply at once, and changing the
tool list mid-session re-writes the whole prompt cache once, so suggest a new session.

## 5. Verify

Re-run the report and show before and after: the total and each change's actual
saving. If a change saved nothing, say so and offer to undo it. End with the "Cost of
turning back on" figures for what was just removed.

## Limits

- The probe runs headless. Interactive sessions defer some tools; the report corrects
  for the ones the latest transcript lists as deferred.
- Usage comes from this machine's transcripts. Sessions elsewhere don't count.
- Sizes change between Claude Code releases; re-run after updates.
