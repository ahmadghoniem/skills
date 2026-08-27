# Reading a grok run's output

On a clean run the output is grok's own write-up and nothing else. No status
table, no file list, no timings, no token count. That silence is deliberate:
everything omitted is either already visible to you (`git status` is one call
away) or noise on the overwhelming majority of runs that simply worked.

Relay the write-up as-is. The user asked for the record, not a precis of it.

## The ⚠ lines

Lines beginning `⚠` are the exceptions the plugin does surface — the ways a run
can be wrong while grok still calls it done. Three rules govern all of them:

1. **Never drop one.** They are the only part of the output that is not
   recoverable by looking at the repo yourself.
2. **Never fold two into one verdict.** grok's own stop reason and the process
   exit code are independent facts that disagree in both directions. Each is
   allowed to fire alone.
3. **Never infer a pass or fail from them.** The plugin deliberately does not
   decide; it puts the fact in front of a human. A ⚠ line is information, not a
   judgement.

## What the plugin can emit

Every warning kind the renderer produces is registered here. `WARNING_IDS` in
`scripts/lib/render.mjs` is the machine-readable copy of this table, and
`tests/contract.test.mjs` fails if the two drift apart.

| id | Line | What it means |
| :--- | :--- | :--- |
| `stop-reason` | `⚠ stop reason: <reason>` | grok's own verdict, verbatim. Not a pass/fail, and not the exit code. |
| `exit` | `⚠ exit N` | The process exit code. Independent of the line above; a good report with a stray non-zero exit is still a good report. |
| `error-detail` | `⚠ error: <reason>` | Why the run stopped, in grok's own words — its `error` event when it emitted one, otherwise the tail of stderr on a failing exit. Independent of the two lines above: those say a run went wrong, this says what went wrong, and a run that dies before emitting anything raises them with nothing to explain it. Further lines are indented under the first. |
| `killed` | `⚠ run was killed before finishing` | Timeout or watchdog. The write-up, if any, is partial. |
| `failed-commands` | `⚠ N commands exited non-zero — reported, not judged; grok may have meant them:` | Terminal commands that returned non-zero, each with its exit code and up to ten lines of output. This does **not** mean the job failed — a `grep` that matches nothing, a deliberately red test in a TDD cycle, and a `command -v` probe all land here legitimately. It is also the part most likely to contradict grok's own account: a failed verification step under a clean stop reason is exactly what this line exists to surface. Report it and move on. |
| `session-lost` | `⚠ no session id was captured — this job cannot be resumed` | The run ended before grok emitted a session id, so `/grok:resume` has nothing to attach to. Re-delegate rather than resume. |
| `resumable` | `⚠ this run ended early — resume it with /grok:resume --resume=<id>` | The other half of the line above, and mutually exclusive with it: the run was cut short but an id exists to attach to, which is the usual shape of a watchdog kill since a fresh dispatch pre-assigns its session with `-s`. Says the option exists; does not tell you to take it. Re-delegating is still the right call when the run had gone off the rails before it was killed. |
