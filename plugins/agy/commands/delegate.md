---
description: Delegate a coding task, code sweep, or research pass to the Antigravity CLI (agy).
argument-hint: '[--model <id>] [--effort <level>] [--timeout <sec>] [--sandbox] [--no-git-check] [--conversation <uuid>] [--continue] <task...>'
allowed-tools: Bash(node:*), AskUserQuestion, Bash(cat:*)
---

`$ARGUMENTS` is the raw text the user typed after `/agy:delegate`.

## What agy is for

agy is the cheap, fast, high-volume worker. Reach for it whenever the work is
well-specified but tedious, and whenever doing it yourself would burn context you
would rather spend on judgement:

- **Code sweeps** — find every call site of X and change it to Y.
- **Mini refactors** — extract a helper, rename through a module, split a file.
- **Bulk reading** — "which of these 40 files defines the retry policy?"
- **Research** — read the docs/spec/changelog and come back with the answer.
- **Implementation** — a scoped feature or fix with clear acceptance criteria.

The point of delegating is that the tokens land in agy's context, not yours. So
send the task and let it read; do not pre-read the whole tree and paste it in.

## Two entrypoints, one job registry

`/agy:delegate` starts a job; `/agy:result [job-id]` inspects it afterwards. Both
share the same file-backed job record (`~/.cad/jobs/<repo-hash>/<name>.json`),
keyed by the **job name** this command prints (kebab slug plus a 4-char suffix,
e.g. `add-retry-to-fetchuser-a7f3`). It also resolves by unique prefix or by the
4-char suffix alone.

## Model: do not ask

The plugin picks the newest, highest-effort **flash** id from the live
`agy models` list on its own. That is the right default for essentially
everything above, and asking about it every time is friction for no gain. Send no
`--model` and say nothing about models.

Ask **one** `AskUserQuestion` only when the user's own message shows they want a
say in what runs. That is a judgement call about intent, not a phrase match — any
of these count, and so does anything in the same spirit:

- they name a model, or a family ("use Gemini Pro", "try the Claude one"),
- they ask what models are available,
- they say the default is not up to this one ("this needs something smarter",
  "the last run was too shallow"),
- they ask for cheaper / faster / stronger,
- they ask you to choose together, or ask which you would pick.

If they name a model outright, just pass it — do not ask to confirm a choice they
already made.

When you do ask, get the real ids first and offer only those:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- --print-models
```

Each line is `id<TAB>label<TAB>effort-in-id|effort-flag`, with an optional
`default` column. Never invent an id. If the chosen id's third column is
`effort-flag` (the slug does **not** end in `-low`/`-medium`/`-high`) and the user
did not already pass `--effort`, ask a second question for effort. If it is
`effort-in-id`, do **not** send `--effort` — agy rejects the combination.

## Run it — always backgrounded

Invoke with the **Bash tool's `run_in_background: true`**. The command itself runs
agy in the foreground of its own process, so the harness sees the exit and tells
you when it lands. The user keeps chatting with you the whole time, and you never
poll for completion.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- --arg-string "$ARGUMENTS"
```

Use `--arg-string` when `$ARGUMENTS` is still one unsplit string (the
slash-command case) so the plugin splits it and newlines survive. When the shell
has already tokenised argv, drop `--arg-string` and pass argv after a leading
`--`; flags go **before** the task, and the task is one quoted argument.

Do **not** pass the plugin's own `--background`. It detaches the worker, which
severs the harness notification and leaves polling as the only way to find out the
job is done. It exists for scripting, not for you.

| Flag | Effect |
| --- | --- |
| `--arg-string <blob>` | Treat `<blob>` as one unsplit argument string and split it here. Omit when argv is already tokenised. |
| `--model <id>` | Pin a model from `agy models`. Omit unless the user chose one. |
| `--effort <level>` | `low`, `medium`, or `high`. Send only when the model id does not already end in `-low`/`-medium`/`-high`. |
| `--timeout <sec>` | Overrides `--print-timeout` and the outer watchdog. Default 900 (15m); the watchdog is that plus 60s grace. |
| `--sandbox` | Restricts terminal commands only. Not a read-only mode. |
| `--no-git-check` | Allow dispatching outside a git repository. |
| `--conversation <uuid>` | Resume a specific conversation. Fresh dispatch is the default. |
| `--continue` | Resume the most recent conversation for this directory. |

## Reading the output

The output is agy's own report, and on a clean run that is all of it. Relay it
without a status table, a file list, or a duration of your own — you have `git
status` and `git diff` if you want the ground truth, and running them is cheaper
than making the user read a summary of them.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/output-contract/contract.md"`

After a job that changed code, review the diff yourself before telling the user it
is done.
