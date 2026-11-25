---
description: Health-check grok, agy and opencode (or the one named): binary, version, sign-in, and agy's bash tool.
argument-hint: '[grok|agy|opencode]'
allowed-tools: Bash(node:*)
---

Run it with the Bash tool. `$ARGUMENTS` names the CLI to check; with none, leave it out and
every CLI is checked:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- [<cli>]

Present the check results as-is. If any check failed, tell the user concretely what to do:

- **grok:** install the Grok CLI, run `grok login`, or set `GROK_BIN`. Do not run the
  installer yourself: it downloads and runs a script from x.ai and changes PATH, which is
  the user's call.
- **agy:** install the Antigravity CLI, set `AGY_BIN`, or fix the JSON in
  `~/.gemini/config/mcp_config.json`. The check also installs the agy plugin that carries
  the bash-delegate agent and its bash tool.
- **opencode:** install it with `bun add -g @opencode/cli`, set `OPENCODE_BIN`, or run
  `/mngr:update opencode`.

Never run an installer yourself. `grok models`, `agy models` and `opencode models` list the
models; `opencode auth list` lists the providers with keys.
