---
description: Read the agy papercut log, cluster the recurring friction, and agree on fixes with the user.
argument-hint: '[--all] [--kind <name>] [--since <YYYY-MM-DD>] [--resolve <id> --note "..."]'
allowed-tools: Bash(node:*), Read, Edit, Grep, Glob
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/kaizen.mjs" -- --arg-string "$ARGUMENTS"`

The output above is the friction log, grouped. Each cluster is one recurring
problem; the count is how many times it has happened.

This is a conversation, not a job. Propose, do not apply. The user decides what
changes and applies it themselves — go back and forth until you both agree.

## How to read it

Clusters are grouped by the warning that produced them, or by where a
hand-written cut came from. There is no tag vocabulary — read the text and see
what actually recurs.

One cut is noise. A cluster of three or more is a pattern worth fixing. Before
proposing anything:

- Read the cluster's evidence rows. They exist so you can judge a cut without
  re-running the delegation — a re-run costs quota and often does not reproduce.
- Check `toolCalls` against `filesChanged`. A run that took forty tool calls to
  change one file went wrong somewhere even if agy reported SUCCESS, and a
  cluster where every cut has that shape is usually a brief problem, not a tool
  problem: the delegatee could not tell what "done" meant, so it kept looking.
- Check the `toolVersion` spread. A cluster that only appears at one version is
  a tool regression to work around. One spread across versions is ours.
- Read any "Recurred after a recorded fix" section first. Those are fixes that
  did not hold, and re-proposing the same fix is the failure mode this log
  exists to catch.

## How to propose a fix

Do not pile on extra notes at the end. Look at the file as a whole and make
redrafts, not additions. Do not shy away from removing guidance that is out of
date or that something later in the file has already overruled.

Read the whole file before deciding where the fix goes. Appending near the
symptom is the reflex; the cause is often an existing sentence that is vague or
wrong, and correcting that one is the smaller change. If nothing in the file is
wrong and the guidance is genuinely missing, add it.

Show the diff. Say which cuts it addresses, by id. If a cluster has no fix you
believe in, say that instead of inventing one.

## Closing a cut

Once the user has applied a change, record it:

```
/agy:kaizen --resolve <id> --note "what changed"
```

That appends a row; it never edits the log. If the same cluster comes back
afterwards the log will say so on the next run, which is the only way this loop
finds out that a fix did not work.
