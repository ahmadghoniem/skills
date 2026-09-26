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

Pass `$ARGUMENTS` through. Before it runs, tell the user in two sentences that it takes
about a minute and doesn't touch their usage limits:
- Claude Code builds a request as usual, but it stays on this machine: a small local
  server takes it in place of Anthropic's API and answers with an error, so no model
  runs.
- Anthropic's token counter (the free `count_tokens` endpoint) does the counting. It
  counts text without running a model and doesn't count toward usage limits.

If counting fails, the report says "estimate" and figures are within about 10%.
Keep the JSON; step 5 compares against it.

## 2. Show where the tokens go

Open with the per-request total for interactive sessions and the three largest kinds.
One short paragraph, no tables yet.

## 3. Pick the candidates

Take candidates from the JSON. Something used in the last two weeks is not a candidate,
however expensive; show its usage and let the user decide. Order each group by tokens.

**Tools and switches**
- **Artifact** (`enableArtifact: false`) removes Artifact, ArtifactComments and
  ArtifactData, together the largest item on most setups. Worth keeping only for
  someone who often shares pages on claude.ai and uses their comments or stored data.
  Without it, Claude writes a local HTML file the user can open or share themselves.
- **PowerShell** (Windows only, `CLAUDE_CODE_USE_POWERSHELL_TOOL=0`). A second shell
  next to Bash. With Git Bash installed, Bash does the same work, and when a Windows
  cmdlet is needed Claude runs it from Bash with `powershell.exe -Command`, so nothing
  Windows-specific is lost. With both loaded, Claude picks a shell on every command.
  Recommend it whenever Git Bash is present, even if the tool was used, and say that
  undoing it is one line.
- **Cron tools** (`CLAUDE_CODE_DISABLE_CRON=1`). They schedule a prompt inside the
  session ("remind me at 2:30", "run the tests every 10 minutes"); a job fires only
  while Claude is idle and ends with the session. `/loop` stops working.
- **Other unused tools**: a bare name in `permissions.deny` (`"NotebookEdit"`). Scoped
  rules (`"Bash(rm:*)"`) remove nothing. Explain each in one line:
  - `RemoteTrigger` manages claude.ai routines, sessions that run in the cloud on a
    schedule or on a GitHub event.
  - `PushNotification` sends a desktop notification, and to the phone while Remote
    Control is connected. Its description is the same size either way, so a user with
    `disableRemoteControl: true` pays for phone text they cannot use.
  - `ListAgents`: "only for messaging other sessions by name; N calls in the window;
    subagents you spawn work without it".
  - `DesignSync` syncs a component library with a claude.ai/design project.
  - `ScheduleWakeup` lets Claude pause and resume itself later; `/loop` uses it.
- Rank deferred tools last: interactive sessions send only their names.
- Never suggest denying `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Skill` or
  `ToolSearch`.

**Skills and plugins**
- Explain the two kinds of skill first. Claude reads the name and description of every
  model-invoked skill on each request, so it takes up context whether it's used or
  not, and Claude may load it on its own. A user-invoked skill is one the user types as
  `/name`. A skill can be set to user-invoked only: Claude no longer reads it on every
  request, and `/name` still works. Many users don't know this setting exists.
- **Typed, never picked by Claude** (`typed > 0`, `modelUses` 0): `skillOverrides`
  `"user-invocable-only"`. Works on built-in skills too (`claude-api`, `code-review`,
  `init`, …).
- **Never used**: `skillOverrides` `"off"`.
- **claude.ai skills** (`syncClaudeAiSkills: false`; the switch lists them in
  `skills`). Skills enabled in the user's claude.ai account sync into Claude Code:
  Anthropic's docx, pptx, xlsx and pdf skills when file creation is on there, plus any
  the user added. Each is instructions and helper scripts, not a tool. Without them
  Claude can still make these files but writes its own script instead of following a
  tested recipe.
- **Plugins**: a plugin's skills leave the listing only when the whole plugin is
  disabled (`enabledPlugins`, `"<plugin>@<marketplace>": false`). Suggest that only when
  every part of it (skills, agents, MCP tools) went unused.
- **MCP servers and claude.ai connectors**: an unused server costs its tools and its
  instructions. `disableClaudeAiConnectors: true` removes all claude.ai connectors.
- **Agents**: only files under `~/.claude/agents/` (`userFile: true`) can be deleted.

**Prompt switches**
- **Short system prompt** (`CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1`). If it saves under 100
  tokens, the account already gets the short prompt: say so and don't offer it.
  Otherwise it is usually the largest switch. It keeps the "confirm before
  hard-to-reverse actions" guidance. It drops the full prompt's guidance on scope and
  code style: don't add features or abstractions beyond the task, no error handling
  for cases that can't happen, default to no comments, watch for injection and XSS,
  test UI changes in a browser, answer exploratory questions briefly before
  implementing, make independent tool calls in parallel. It also shortens tool
  descriptions and the built-in git instructions. Say it is the one cut that can change
  behaviour, and offer a short `~/.claude/rules/` file with the dropped lines the user
  wants back (about 200 tokens).
- **Built-in git instructions** (`includeGitInstructions: false`), a separate cut
  whether or not the short prompt is on. It removes the commit and pull-request steps
  from the Bash tool (about 2,200 tokens with the full prompt, about 150 with the short
  one) and the git status snapshot of the current repo added to every session (its
  size depends on the repo: branch, changed files, recent commits). Claude still runs
  git; it loses Anthropic's commit-message and PR checklist. Offer a prompt the user
  can give their agent to write a short `~/.claude/rules/git.md` in their own
  conventions (branch naming, commit style, what never to force-push).
- **Explore/Plan agents** (`CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1`). If they were
  spawned, explain: Explore is a read-only search agent, Plan does plan-mode research,
  and Explore now runs on the main model, so it saves nothing over general-purpose. The
  user can ask their agent to write a read-only agent on a cheaper model instead. If
  never spawned, one line.

**Background requests**: always suggest the ones that are off, whatever the usage.
Each re-sends the whole conversation as a side request, which counts against usage;
the probe cannot see them. Run
`node "${CLAUDE_SKILL_DIR}/scripts/lean.mjs" stretch --saved 0` for the numbers below.
- `promptSuggestionEnabled: false`: the greyed-out next prompt in the input box. Each
  one reads the whole context with the main model after a turn. Give
  `suggestionShareMax` as "up to N% of your usage in the last 30 days" (upper bound:
  the CLI doesn't log them). Many users say they never see one: the request still
  runs, but the model is told to stay silent unless the next step is obvious, and a
  filter drops answers that are too short, too long, evaluative or several sentences,
  so the user pays for suggestions that never show. If `suggestionsServerOn` is
  `false`, the account doesn't generate them and the switch saves nothing; say so.
- `awaySummaryEnabled: false`: the recap written when the terminal loses focus.
  `/recap` still works on demand. On the author's machine recaps were 1.5–2% of usage.

**Do not suggest** `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`. It saves little more than
`user-invocable-only` and makes every bundled command untypable. Mention it only if
the user asks.

Report large `CLAUDE.md` and rules files with their size. Never edit them here.

## 4. Ask, then apply

Ask with AskUserQuestion, one multi-select question per group: Tools, Skills and
plugins, Prompt switches, Background requests. Skip empty groups. A question takes
at most 4 options, so bundle items that share a reason into one option:
- Tools: Artifact · PowerShell · "Unused scheduling: Cron tools, ScheduleWakeup" ·
  "Other unused tools: RemoteTrigger, DesignSync, PushNotification, …".
- Skills: "Hide from Claude, keep typable: claude-api, code-review" · "Off, never
  used: …" · "claude.ai skills" · one option per unused plugin.

Each option:
- label: the change and its total saving, `Unused scheduling (−3,582)`
- description: every item with its own saving and uses (`run −264 · update-config
  −235 · …`), then what the user loses

End a question that has a bundle with: "To keep something inside a bundle, pick it
and name what to keep in Other." If a group still has more than 4 options, ask a
second round for the rest.

Apply only what was picked:
- `~/.claude/settings.json`: read it first and keep every other key. Bare names go in
  `permissions.deny`, env switches in `env`, other keys at the top level.
- Skill frontmatter and agent files: edit in place.

Changes apply from the next session. Deny rules also apply at once, and changing the
tool list mid-session re-writes the whole prompt cache once, so suggest a new session.

## 5. Verify and report

Re-run the report, then run
`node "${CLAUDE_SKILL_DIR}/scripts/lean.mjs" stretch --saved <before − after>`.

Lead with the result in one sentence: "Every request now starts with A tokens instead
of B: N fewer (P%)." Then:
- a table of each change and its actual saving, largest first;
- the usage limit: "Over the last 30 days the removed part was S% of your usage, so the
  same limit should go about X% further." Take S and X from `share` and `stretch`, and
  give the low and high `further` in `range` in brackets. Anthropic doesn't publish how
  plan limits weigh cached tokens, so the range covers cache reads counted free, at API
  price, and at full price;
- the background requests turned off, with their share, as a separate line;
- what turning each change back on costs, from the report's restore table.

If a change saved nothing, say so and offer to undo it.

## Limits

- The probe runs headless. Interactive sessions defer some tools; the report corrects
  for the ones the latest transcript lists as deferred.
- Usage comes from this machine's transcripts. Sessions elsewhere don't count.
- Sizes change between Claude Code releases; re-run after updates.
