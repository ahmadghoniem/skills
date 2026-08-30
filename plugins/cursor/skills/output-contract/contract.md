# Reading a cursor run's output

On a clean run the output is cursor-agent's own write-up and nothing else. No
status table, no file list, no timings, no token count. That silence is
deliberate: everything omitted is either already visible to you (`git status` is
one call away) or noise on the overwhelming majority of runs that simply worked.

Relay the write-up as-is. The user asked for the record, not a precis of it.

## The ⚠ lines

Lines beginning `⚠` are the exceptions the plugin does surface — the ways a run
can be wrong while cursor-agent still calls it done. Three rules govern all of
them:

1. **Never drop one.** They are the only part of the output that is not
   recoverable by looking at the repo yourself.
2. **Never fold two into one verdict.** cursor-agent's own success flag and the
   process exit code are independent facts that disagree in both directions.
   Each is allowed to fire alone.
3. **Never infer a pass or fail from them.** The plugin deliberately does not
   decide; it puts the fact in front of a human. A ⚠ line is information, not a
   judgement.

## What the plugin can emit

Every warning kind the renderer produces is registered here. `WARNING_IDS` in
`scripts/lib/render.mjs` is the machine-readable copy of this table, and
`tests/contract.test.mjs` fails if the two drift apart.

| id | Line | What it means |
| :--- | :--- | :--- |
| `ran-as` | `⚠ ran as <model>, not the model the dispatch line named` | Only surfaced when it is a surprise. Pin a model and you get it, and the banner already said so; ask for `auto` and this is the only place the concrete id the run actually used ever appears. |
| `no-success` | `⚠ cursor-agent did not report success (<reason>)` | cursor-agent's own verdict. Not the exit code. |
| `exit` | `⚠ exit N` | The process exit code. Independent of the line above; a good report with a stray non-zero exit is still a good report. |
| `killed` | `⚠ run was killed before finishing` | Timeout or watchdog. The write-up, if any, is partial. |
| `failed-commands` | `⚠ N commands exited non-zero — reported, not judged; cursor-agent may have meant them:` | Terminal commands that returned non-zero, each with its exit code and up to ten lines of output. This does **not** mean the job failed — a `grep` that matches nothing, a deliberately red test in a TDD cycle, and a `command -v` probe all land here legitimately. It is also the part most likely to contradict cursor-agent's own account: a failed verification step under a clean success flag is exactly what this line exists to surface. Report it and move on. |
| `chat-lost` | `⚠ no cursor chat id was captured — this job cannot be resumed` | The run ended before cursor-agent emitted a chat id, so `/cursor:resume` has nothing to attach to. Re-delegate rather than resume. |
