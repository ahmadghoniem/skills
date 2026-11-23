# Reading an opencode run's output

On a clean run, the output is opencode's own write-up followed by one stats
line. No status table, no file list: repository changes are directly
inspectable with `git status` and `git diff`.

Relay the write-up as-is without summarizing.

## The stats line

The last line of a run reads like
`nebius/deepseek-ai/DeepSeek-V4.1-Flash  ·  $0.0178  ·  17339 in / 323 out, 20736 cached  ·  3 tool calls  ·  14.2s`.

Every number there comes from opencode's own `step_finish` events, summed
across the run. It records what the run consumed. It says nothing about
whether the work is right, and it is not a warning — do not read a cheap run
as a good one.

## The ⚠ lines

Lines beginning `⚠` are the exceptions the plugin does surface — the ways a
run can be wrong while opencode still exits 0. Three rules govern all of them:

1. **Never drop one.** They are the only part of the output that is not
   recoverable by looking at the repo yourself.
2. **Never fold two into one verdict.** The finish reason, the process exit
   code, and what opencode wrote to stderr are independent facts that disagree
   in both directions. Each is allowed to fire alone.
3. **Never infer a pass or fail from them.** The plugin reports facts; a ⚠
   line is information, not a judgement.

`delegate.mjs` exits 1 when the run did not finish. That is a fact about the
run, not a verdict on the work; the ⚠ lines say why.

## What `tool-errors` does not catch

opencode marks a tool `completed` whenever the tool itself ran, **including
when the command it ran failed**. A `bash` step whose command exits non-zero
is `completed`, with the shell's error text sitting in its output. Only a tool
that could not run at all reports `error`.

So `⚠ N tool calls failed to run` undercounts on purpose: it is not a
test-failure detector, and its absence is not evidence that the verification
command passed. Run the verification yourself.

## What the plugin can emit

Every warning kind the renderer produces is registered here. `WARNING_IDS` in
`scripts/lib/render.mjs` is the machine-readable copy of this table, and
`tests/contract.test.mjs` fails if the two drift apart.

| id | Line | What it means |
| :--- | :--- | :--- |
| `finish-reason` | `⚠ opencode stopped with reason: <reason> (write-up present)` | The `reason` on the last `step_finish`, verbatim. `stop` is the only one that means the model finished its turn, and it raises no line. `tool-calls` means the run ended on a tool call with no closing message — the work is likely partial. `length` means the output limit cut it off. The parenthetical says only whether a write-up came back. |
| `exit` | `⚠ exit N` | The process exit code. Independent of the line above; a good report with a stray non-zero exit is still a good report. |
| `stderr` | `⚠ opencode wrote to stderr:` | Everything opencode wrote to stderr (last 20 lines), on any run. opencode is silent there when nothing went wrong, so this carries startup failures: an unauthenticated provider, an unknown `--model`, a rejected flag, a spawn failure. |
| `tool-errors` | `⚠ N tool calls failed to run — reported, not judged:` | Tools opencode could not execute. **Not** commands that ran and failed — see the section above. Deduped and capped at three. |
| `opencode-error` | `⚠ <name> <status>: <message>` | An error envelope from the event stream. A provider error nests its sentence at `data.message` and carries a whole HTTP envelope alongside it — headers, response body, trace URLs — so only the name, the status code and the message are shown. A long tail is truncated with a count; the full text is in the job's NDJSON log. |
| `no-finish` | `⚠ opencode opened a session but never completed a step — no work was done` | A session id exists but no `step_finish` ever arrived, so there is no finish reason to judge. This is what a provider error looks like from outside: the session opens, the first request comes back 4xx, the process exits having emitted one `error` event and nothing else. Without this line such a run reports as a success — the `no-session` test does not fire, because there *is* a session. It also forces the job to `failed` and the exit code to 1. |
| `watchdog` | `⚠ watchdog killed the run — the timeout elapsed with opencode still working` | `opencode run` has no timeout flag of its own, so the plugin holds the only clock. When it fires, the process tree was killed and the write-up, if any, is partial. |
| `no-session` | `⚠ opencode opened no session — it exited before starting work` | No event ever carried a `sessionID`, so opencode died during startup: a bad flag, an unknown model, or a provider with no credentials. Nothing was done and nothing can be resumed. Read the `stderr` line above it for the cause. |
| `resume` | `⚠ this run can be resumed where it stopped: /opencode:resume <id>` | The run ended before opencode finished and a session id was recorded. Resuming keeps what opencode already read and changed; a fresh dispatch starts from zero. Find out what the run already did first — by diff or by reading the files: resume only if the work is missing, and prefer it to a new dispatch. |
