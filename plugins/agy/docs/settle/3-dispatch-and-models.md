# agy settle list 3 of 3: dispatch, waiting, models and timeouts

How a brief gets to agy, how the caller waits, which model and effort run it, and how long it
may take. Lands after files 1 and 2, one commit per item.

---

## Background: what agy-runner is

`agents/agy-runner.md` defines a Claude Code **subagent**. When Claude calls its Agent tool
with type `agy:agy-runner`, Claude Code starts a second, separate Claude conversation. That file
is its instructions, and its tools are limited to Bash, Read, Monitor and AskUserQuestion. That
second conversation is the session you see titled "agy-runner" inside the main one.

Its intended job: turn the main conversation's request into a brief, run `delegate.mjs` in the
background, wait for agy to finish, and hand agy's report back. The main conversation waits
for the subagent's final message, and only that message comes back to it.

---

## K5. The runner's background dispatch is stopped when the runner ends its turn (high)

**Story.** A background Bash task belongs to the conversation that started it. The runner
prompt says: start `delegate.mjs` with `run_in_background: true`, then "stop and wait" for the
completion notification (`agy-runner.md:83`). The notification is supposed to wake the runner.
A subagent that ends its turn has finished, though, and its final message goes back to the
main conversation.

**What the caller eval saw.** Three valid runner sessions, headless `claude -p`, with a fake agy:

- 2 runs: the runner followed its prompt, ended its turn with "Waiting for the agy job to
  finish", and Claude Code marked the delegate task `killed`, notification status `stopped`,
  before the job finished. Main Claude got "waiting" as the runner's whole report. In one of
  the two, it then fixed the bug itself.
- 1 run: the job survived because the runner broke the rule and sat in a blocking wait loop.
- All 3 runs: the runner also started `Monitor` on the task output.

The wrapper was stopped, so the job record stays `running` (file 2, I2). Whether a real agy
process survives its wrapper was not tested, since the eval used a fake agy. Interactive
sessions were not tested either.

**The conflict.** A runner that waits correctly gets its job stopped. A runner that keeps its
job alive has to poll, which D1 and D2 forbid. A foreground Bash call cannot wait either: its
limit is 10 minutes and agy runs take up to 15 minutes by default, 60 if T1 is taken.

**Main conversation vs subagent, for saving Claude usage.** Subagent tokens count toward the
same usage limit as the main conversation, so a subagent does not make work free. It only
changes where the tokens land.

| | Dispatch from the main conversation | Dispatch through agy-runner |
| --- | --- | --- |
| Job survives until agy finishes | Yes, in the eval | No, stopped in 2 of 3 eval runs (K5) |
| Claude tokens per dispatch | The dispatch command and agy's report | A whole extra conversation: across 20 real runner spawns, median 8 model calls, 43k tokens written to cache and 172k tokens processed in total (range 33k to 822k), before agy's report is added to the main context anyway |
| What enters the main context | The brief (as a file path after C1), agy's report | The task prompt given to the runner, then agy's report, which the runner returns verbatim |
| Main conversation keeps working meanwhile | Yes, the dispatch is a background task | Yes, if the Agent call runs in the background |
| Brief quality | Main Claude writes it with full context of the conversation | The runner rewrites a brief from a shorter prompt |

agy's report reaches the main context either way, since the runner is told to return it
verbatim. With C1 the brief is a file, so it does not enter either context as text. The runner
therefore saves nothing and adds a whole conversation per dispatch. The larger Claude-side costs
are elsewhere: reading the repo before writing a brief (G1) and polling, since every poll is
another turn of the whole main context. The three-job eval case that polled cost $3.58 to
$8.74 per run, against $0.18 to $0.44 for a single dispatch that waited.

**Handoffs.** Through the runner, the task passes through two rewrites before agy sees it: main
Claude summarises it into a prompt for the runner, and the runner turns that into a brief. The
runner never saw the conversation that produced the task, so anything main Claude left out of its
prompt is lost. Polylane's write-up on replacing their sub-agent pipeline with one agent reports
the same failure: each summary between agents dropped context the next agent needed.

**Recommendation.** Dispatch from the main conversation. It stays alive, receives the
notification, and in the eval single dispatches from the main conversation waited correctly.
Keep the brief-writing guidance as the `/agy:delegate` command text. Retire `agy-runner`, or
first confirm K5 in an interactive session if you want to keep it.

## G2. Dropped: reusing one runner

**Story.** The idea was to reuse one agy-runner across dispatches instead of starting a new one
each time, since each new runner pays for its own instructions and the output contract before
doing anything, about 8,000 tokens at its first call, and then every later call re-sends its growing context: median 172k tokens processed per spawn across 20 real spawns.

**Why dropped.** Reuse would only trim the start-up part of a cost that is mostly the runner's own
calls. K5 retires the runner, which removes the whole cost.

## C1 and C2. Pass the brief as a file path

**Story.** agy already reads the brief from a file: `delegate.mjs` writes it to
`~/.cad/jobs/<repo>/<job>.prompt.md` and tells agy to read that file. The weak step is before
that. Claude has to put the whole brief into a Bash command line to call `delegate.mjs`. A long
brief then hits the heredoc size limit on Windows (about 5 to 7 KB, see
`~/.claude/rules/windows.md`) and shell quoting problems. In the caller eval, Claude saved a
17 KB brief to a file, then pasted it back into the command with `$(cat spec.txt)`, which puts it
through the command line anyway. In an earlier session a heredoc failed near 5 KB and was rebuilt
with four appends.

**What "the Write tool" means.** Claude Code has a Write tool that creates a file from content
directly, with no shell involved, so no heredoc, no quoting and no size limit on the command
line. Claude writes the brief with Write, then runs a short command that passes only the path.

**Where `--prompt-file` comes from.** agy has no such flag. Its only ways to take a prompt are
`--print <text>` and NDJSON on stdin with `--input-format stream-json` (`agy --help`, 1.2.2). The
name is taken from the grok plugin, whose `delegate.mjs` already accepts `--prompt-file <path|->`.

**What agy receives stays the same.** agy is already told "Read the file at <path> in full and
carry out that task exactly" and reads the brief from that file. C1 only changes how the brief
reaches the plugin: from text in a command line to a file Claude wrote.

**Change.**
- C1: add `--prompt-file <path>` to `delegate.mjs` and `resume.mjs`. The plugin copies that file
  to the job's sidecar, so the job keeps its own copy if Claude edits or deletes the original,
  and agy is pointed at the sidecar as today.
- C2: `commands/delegate.md` tells Claude to write every brief with the Write tool and pass
  `--prompt-file`. Short one-line tasks can stay inline.

## D1. One waiting rule, and a useful `/agy:result` for running jobs

**Rule.** After dispatch, wait for the task notification. If the user asks for status, run
`/agy:result`. Do not read the job log or event stream during the run.

**Why not read the logs.** On 2026-09-08 a runner wrote wait loops against the task output for
35 minutes while the notification was already on its way. Twice, a caller read the event stream
mid-run, saw a tool call that agy later retried successfully, and reported a failed write.

**Is `/agy:result` as good as reading the log?** Not today. On a running job it prints one line,
"still running", and nothing else. Reading the NDJSON log gives more, but it is large, costs
context, and needs agy's event format to interpret. Partial state is also easy to misjudge.

**Change.** Give `/agy:result` a short progress block for running jobs, computed from the log:
elapsed time, number of tool calls, the last tool used, tool failures so far (marked "agy may
retry"), and whether the model has started its write-up. That covers what a caller wants from
the log in a few lines, and makes the rule easy to follow.

## D2. A PreToolUse hook that blocks polling, only if a retest still shows polling

**Order.** Do not build it yet. Land files 1 to 3 without it, rerun the caller eval
(`AGY_EVAL_LIVE=1 AGY_EVAL_CASES=three-in-parallel,simple-delegation`), and build the hook only if
Claude still polls.

**What it is.** Claude Code hooks are commands the harness runs at fixed points. A `PreToolUse`
hook runs before every tool call, sees the tool name and its input, and can refuse the call with
a message that Claude reads. The plugin would ship one in its hooks config.

**What it would block.**
- Bash commands containing `sleep`, `until` or `while` loops that read a task output file or
  `~/.cad/jobs/*.ndjson`.
- `Monitor` on a task output file or a job log.
- Read or `cat` of a running job's `.ndjson` log.

Each refusal says: "agy job <id> is still running. Wait for the task notification, or run
/agy:result <id> for progress."

The hook knows a job is running by reading its job record (`status: running`, pids alive).

**Scenarios.**

| Claude's tool call while job `a7f3` runs | Hook |
| --- | --- |
| `until grep -q "agy \`" task.output; do sleep 30; done` | Refused |
| `for i in 1 2 3 4 5; do node result.mjs a7f3; sleep 60; done` | Refused: a loop around `result.mjs` |
| One `node result.mjs a7f3` because the user asked "how is it going?" | Allowed |
| `Monitor` running `tail -f` on the task output | Refused |
| Read of `~/.cad/jobs/<repo>/a7f3.ndjson` | Refused while running, allowed after the job finishes |
| `sleep 5 && npm test` or a `while` loop in a build script with no agy path in it | Allowed |
| Any of the above after the notification arrived | Allowed |

**Why a hook.** The rule is already in the runner prompt (uncommitted edits) and has not held. In the
caller eval, the three-job case polled `/agy:result` in shell loops in both runs, and the runner
used Monitor in all three runs.

**Depends on K5.** If the runner stays and must keep its job alive by waiting, the hook would
block the only thing keeping the job alive. With dispatch from the main conversation there is
no conflict.

## D3. Commit the runner prompt edits in the working tree

`agents/agy-runner.md` has uncommitted edits, including the waiting rule. Commit with this batch,
or drop them if K5 retires the runner.

## F2. Resume keeps every flag

**Story.** When `/agy:resume` is given a job id or conversation id, `resume.mjs:52` rebuilds the
arguments by hand from five flags: sandbox, model, effort, timeout and `--no-git-check`. Any other
flag is dropped, so `--prompt-file` from C1 would be lost on resume.

**Change.** Pass through every flag except the job id.

## F3. Resume with no id

**Story.** With no job id, `/agy:resume` takes this repo's newest job and continues its
conversation. If that job has no conversation id, it falls back to agy's `--continue`.

**What changed in agy 1.2.1** (corrected reading of the changelog). `--continue` used to start a
brand-new conversation, silently, when run from a subfolder, after a crash, or while another agy
session was open in the same workspace. It now falls back to the most recent non-empty
conversation in the current workspace or its parent and child folders. The earlier note that
`--continue` used to pick any conversation on the machine came from the plugin's own comment in
`resume.mjs`, not from the changelog, and is unverified.

**Remaining issues.** "Newest job in this repo" can belong to another Claude session working in
the same repo. The newest job has no conversation id only when it never started, and then
`--continue` resumes some other conversation.

**Change.** With no id, use the newest job that has a conversation id. Drop the `--continue`
fallback and say "no resumable job in this repo" instead.

---

## M1. Effort for every model

**What agy accepts** (checked on 1.2.2, 2026-09-13):

| Model family | Ids in `agy models` | `--model <family> --effort <level>` |
| --- | --- | --- |
| Gemini 3.8, 3.7, 3.6 Flash | `-high`, `-medium`, `-low` | works, agy picks the id |
| Gemini 3.1 Pro | `-high`, `-low` | `medium` refused: "has no medium effort (available: low, high)" |
| GPT-OSS 120B | `-medium` only | works |
| Claude Sonnet 4.6, Claude Opus 4.6 (Thinking) | one id each, no level | refused: "--effort is not supported" |

**Current plugin behaviour.** It drops `--effort` only when the model id ends in a level
(`agy.mjs:24`). `claude-opus-4-6-thinking` does not, so `--effort` is sent and agy refuses the run.

**Change.** Let Claude pass a family name or a full id, plus `--effort`. The plugin checks the cached
model list:
- The family has levels: pass `--model <family> --effort <level>` and let agy pick the id. If the
  level does not exist for that family, agy's error already names the available ones.
- The model has no levels (Claude models): drop `--effort` and print one note line saying effort
  does not apply to that model.
- A full id that already ends in a level: pass it as is, without `--effort`.

`commands/delegate.md` gets a short table of families and their levels, generated from the cache,
so Claude can map "use opus" or "pro, high effort" without guessing.

## M2. Default model, and a name that matches nothing

**Current.** With no `--model`, the plugin picks the newest flash id at the requested effort,
`gemini-3.8-flash-medium` today, from the cached list. Resume keeps the conversation's model.

**Change.** Keep the default. When agy refuses with `invalid model selection`, print the valid ids
from the cache as the ⚠ detail. agy's own message lists display names such as
"Gemini 3.8 Flash (High)", which cannot be passed to `--model`.

## M3. Refresh the model cache independently of the agy version

**Story.** `~/.cad/models.json` is written only by `/agy:setup`. It stores the model list and the
agy version. The model list comes from Google's servers for your account, so models can appear or
disappear without any agy update. Tying the refresh to an update alone would miss those.

**Change.** Two triggers, no added delay before a run:
- After a run ends, refresh the cache in the background when it is older than a week.
  `agy models` takes about 1.8 s. New models appear rarely, and the second trigger covers a model
  the user names before the weekly refresh. The cost of a week: a newer default flash model is
  picked up up to seven days late.
- On `invalid model selection`, refresh right away before printing the list in M2.

The agy version stamp is read separately with `agy --version`, about 0.1 s, when papercuts are
written.

## H1. Build `/agy:update`

Record the current agy version, run `agy update`, read `agy changelog` between the old and new
version, refresh the model cache (M3), and hand the orchestrator that changelog slice with the
instruction to check it against this plugin for workarounds that are no longer needed.
`/agy:setup` stays as the health check.

## T1. Timeouts

**How agy's timeout works.** Each run gets one limit, passed to agy as `--print-timeout`. It is
900 s unless the dispatch passed `--timeout <sec>`, which replaces it. agy's help calls it
"Timeout for print mode wait". It counts total time from the start of the run, not idle time:
runs stopped at their limit while agy was still busy, with 142 to 885 events in the log.

The job record does not store which limit a run had. I matched each timed-out job to its dispatch
command in the Claude Code transcripts (2026-09-14):

| Wall time at the end | `--timeout` in the dispatch command | Runs |
| --- | --- | --- |
| 905 to 916 s | not found in any transcript, so most likely the 900 s default | 8 |
| 1217 s | not found | 1 |
| 2106 s | `2100` (found) | 1 |
| 2405 to 2407 s | `2400` found for one, not found for two | 3 |
| 3604 to 3613 s | `3600` found for one, not found for four | 5 |

Where a flag was found, the run ended within 13 s of it. Where it was not found (the brief went
through a launcher script or `--arg-string`), the wall times still sit just above round limits.
So "hit the limit" means the limit that run was given, which was the 900 s default for about half
of them and one hour for five.

**Grok, for comparison** (from the grok plugin's code, 2026-09-14): its watchdog default is
4800 s, raised from 3600 s on 2026-08-27 (`bfcd3cb`). The plugin describes grok's own limit as a
3600 s *idle* timeout, and set the watchdog 1200 s above it so grok stops first and says why. I
did not confirm the 3600 s against grok itself. So your numbers match the plugin: one hour on
grok's side, 4800 s for the watchdog.

| Timeout | Now | Proposal | Reason |
| --- | --- | --- | --- |
| agy `--print-timeout` | 900 s | **3600 s** | Real runs go past 900 s often, and five runs ran out even at one hour. A timeout now returns partial output and, with F1, a resume line, so a long limit costs little. |
| Plugin watchdog | timeout + 60 s | keep at + 60 s | Unlike grok, agy's limit is total time, and since 1.1.28 agy stops itself exactly at it. The watchdog only covers an agy that hangs. |
| Kill wait, called "grace" | 5 s | rename, fix the wording | Back story below. |
| `where agy` | 5 s | keep, and store the resolved path | About 150 ms, but runs on every dispatch unless `AGY_BIN` is set. |
| `agy --version` | 5 s | keep | About 100 ms, local. Only stops a hung binary from hanging `/agy:setup`. |
| `agy models` | 10 s | keep | About 1.8 s, a network call. Stops a network stall from hanging setup. |
| Job record pruning | 30 days | keep | |
| git calls | 3 s, 5 s | gone after file 1 | |

**Back story of the 5 s "grace".** `killtree.mjs` was written for the cursor plugin on 2026-08-23
(`bc2f1ce`), after cancel was found to kill only the node wrapper while the CLI child kept running.
It had two paths:

- macOS and Linux: send SIGTERM to the whole process group, wait up to `graceMs` for it to exit
  cleanly, then SIGKILL. There the 5 s really was a grace period.
- Windows: `taskkill /PID <pid> /T /F`, which force-kills the whole tree at once. Windows has no
  SIGTERM that a console program can catch this way.

agy copied the file on 2026-08-24. On 2026-08-26 (`cb1553f`, "Windows-only: drop every non-win32
code path") the macOS and Linux path was deleted. The `graceMs` parameter stayed, and on Windows it
only limits how long the plugin waits for `taskkill` to return before also killing the direct
child. So force kill is the first and only approach on Windows. The "SIGTERM, then SIGKILL after
5 s" wording is left over from the deleted path.

Change, since the plugin is Windows-only:
- Delete "(SIGTERM, then SIGKILL after 5 s)" from the `commands/cancel.md` description, and any
  other SIGTERM wording in comments. The description becomes "Cancel an active agy job by
  force-killing agy and its child processes."
- Rename `graceMs` to `taskkillTimeoutMs` in `killtree.mjs`, `run.mjs`, `agy.mjs` and `jobs.mjs`.

Whether a force-killed agy conversation can still be resumed is untested.

---

## Settled, no task

- **Permission bypass.** agy always runs with `--dangerously-skip-permissions` (`agy.mjs:108`),
  and no flag turns it off. URL fetching, which agy 1.1.28 put behind approval, ran without a
  prompt under that flag on 1.2.2. File 2 B2 is only a guard.
- **agy's own subagents (E1).** The ban was considered because on agy 1.1.x a Tailwind audit that
  told agy to spawn subagents returned nothing. The parent sat idle while its subagents worked,
  and the connection dropped (`7911ca4c`, recorded in `docs/buried-items.md`). The fan-out eval
  on 1.2.2 sent three plain and three subagent briefs. All six finished, and all three subagent
  runs used subagents and returned a write-up. No ban. A run that idles for much longer than four
  minutes is still untested.
- **Max fan-out** is 3 to 5 parallel agy jobs.
- **The context limit (I3), verified 2026-09-15.** Your research is right about the settings.
  - **agy's own config.** Every conversation database under
    `~/.gemini/antigravity-cli/conversations/<id>.db` stores an `executor_metadata` record. Decoded
    against the field names in the agy 1.2.2 binary, its checkpoint settings are
    `token_threshold 140000`, `max_token_limit 256000`, `max_output_tokens 16384`, `full_async 1`,
    `is_sync 1` and `max_user_requests 10`. The values are the same for Gemini 3.7 Flash High and
    3.8 Flash, and for a run on 1.1.x (2026-09-08).
  - **When the smaller context actually appears.** Later than 140k in every case. Across job records,
    29 compactions showed up at 222k to 262k tokens in one model call. In a live 1.2.2 test (six
    72k-token files read in full), context passed 140k at 21:01:36, kept growing to 344k, and the
    `CHECKPOINT` step landed at 21:02:31, 55 seconds later. The run then grew to 321k again and
    finished `SUCCESS` with every answer correct.
  - **Likely reason, not confirmed.** With `full_async 1`, agy probably starts writing the summary
    in the background when the threshold is crossed and keeps working until it is ready, so the
    switch lands one to several calls later. How a call reached 344k with `max_token_limit 256000`
    is not explained by this data.
  - **What a compaction is.** A `CHECKPOINT` step: "Resuming from a compaction … you have lost
    access to the full conversation history", then a summary of at most 16,384 tokens.
    `stream-json` reports it as `step_type: "checkpoint"`.
  - **The brief survives it.** In all 50 compactions in plugin runs, the summary kept the original
    request, "Read the file at <sidecar path>". After the 39 compactions that happened mid-run, agy
    re-read the brief file 19 times and never re-read it 20 times.
  - **The plugin uses none of this today.** No script, command or prompt mentions the context size or
    compaction. File 2, X1, adds it to the output.
