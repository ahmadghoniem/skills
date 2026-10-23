# Pickup: do the agy-chore citation rules raise recall without adding time?

## Where things stand (2026-10-13)

Commit `ec0374f` on `agy-chore` (pushed) added two rules to `agy-agents/agy-chore.md`:

- every citation uses the full workspace-relative path, repeated ones included;
- searches are not piped into `head` or `tail`.

They target the recall gap on Sonnet 5.5 low, d07: stock agy 0.81, agy-chore 0.50
(0.63 counting bare file names such as `App.tsx:12`).

The rules are untested on Sonnet. The Sonnet quota ran out (429) on the first try.
One run on Gemini 3.8 flash low, d07, shows nothing either way:

| d07, flash low | recall | answered | turns | broken |
|---|---|---|---|---|
| agy-chore, new rules | 0.72 | 190 s | 54 | 3/83 |
| agy-chore, before | 0.69 | 131 s | 43 | 1/62 |
| stock | 0.69 | 254 s | 54 | 3/110 |

One run per task is too noisy: differences under about 0.10 recall are probably noise.

Baselines, 5 tasks (d01 d02 d06 d07 d10), one run each:

| | stock recall / answered | agy-chore recall / answered |
|---|---|---|
| Sonnet 5.5 low | 0.59 / 579 s | 0.52 / 341 s |
| flash 3.8 low | 0.59 / 1,342 s | 0.54 / 660 s |

d10 scores 0.20 to 0.32 on every setup. It is a broad survey whose reference cites
31 files, so it measures the scoring more than the agent. Leave it out.

## Next test

Sonnet 5.5 low, tasks d01 and d07, 3 runs with the old agy-chore.md and 3 with the
new one, alternating on the same day (turn time varies up to 1.6x between days).
About 12 runs of roughly 70 s each.

`run.mjs` has no switch for the agent file, so swap the file in place between
batches. Before every run, `installAgent` (`scripts/lib/agy.mjs:137`) copies it to
`~/.gemini/config/agents/agy-chore.md` if the two differ, so each batch uses the
file in the repo at that moment.

```
cd "C:/Users/Ahmed Ibrahim/Documents/GitHub/skills/plugins/agy"
E="$HOME/.cad/scratch/lookup-eval2"
mkdir -p "$E/ab"
cp agy-agents/agy-chore.md "$E/ab/chore-new.md"
git show ec0374f^:plugins/agy/agy-agents/agy-chore.md > "$E/ab/chore-old.md"
for i in 1 2 3; do
  for v in old new; do
    cp "$E/ab/chore-$v.md" agy-agents/agy-chore.md
    node evals/bench/run.mjs --arm custom --tasks "$E/tasks.json" --repo "$E/repo" \
      --out "$E/ab/$v-$i" --only d01,d07 --workers 2 --timeout 600 --model claude-sonnet-5-5-low
  done
done
cp "$E/ab/chore-new.md" agy-agents/agy-chore.md
git diff --stat agy-agents/agy-chore.md   # must print nothing
for d in "$E"/ab/*-[123]; do echo "== $d"; node evals/bench/recall.mjs --tasks "$E/tasks.json" --results "$d" --repo "$E/repo" | tail -1; done
```

If a run prints `QUOTA - stopping`, the quota ran out: restore the new file with
the `cp` above before anything else.

`$E/results-rules-d07/` holds the failed quota run; ignore it.

## How to decide

- Mean recall of `new` beats `old` by 0.10 or more, answered time within about
  20%: keep the rules.
- Recall up, time up too: the rules make it search more; decide if that is worth it.
- Recall flat: revert the two rules (`git revert ec0374f` touches the bench too, so
  edit agy-chore.md and its CHANGELOG entry by hand), then try the untested rule
  "settle inferred parts before answering": d07's report marked items 6 and 7 as
  inferred instead of searching for them.
