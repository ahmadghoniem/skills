# agy plugin evals

Kept apart from the unit tests. `npm test` never runs them.

```
npm run eval          # offline evals only; live ones are skipped
npm run eval:live     # everything, spends agy quota and Claude usage
npm run eval -- reporting   # one eval by name
```

Each run writes `results/<eval>/<timestamp>/` with `results.jsonl` (one row per
case, appended as cases finish), `summary.md` and `summary.json`. `results/` is
not committed.

## The four evals

| Eval | Question | Runs against | Cost |
| --- | --- | --- | --- |
| `reporting` | Does the plugin tell the caller the truth about a run? | Every recorded agy run, replayed through the real scripts against a stub agy, plus scripted scenarios | Free, about 80 s |
| `outcomes` | Given a well-formed brief, does the work land? | Live agy on small throwaway repos, graded on end state | agy quota, about 3 min |
| `caller` | Does Claude Code use the plugin the way it asks to be used? | Live `claude -p` sessions, stub agy | Claude usage, about 10 min |
| `fanout` | Does a brief telling agy to use its own subagents survive? | Live agy, plain vs subagent brief | agy quota, up to 10 min |

Every check names the flaw it tracks, using the ids in the agy Run Paths
artifact and `docs/settle/`. A failing check is a known flaw that has
not been fixed yet, not a broken eval.

## Fixtures

`fixtures/replay/` holds two kinds. The `rec-*` fixtures were built from the
event logs jobs used to write to `~/.cad/jobs`; jobs no longer write them, so
those fixtures cannot be rebuilt and a rebuild leaves them alone. The `live-*`
fixtures are built by `build-fixtures.mjs` from any capture dropped into
`fixtures/live/`. Write-ups, tool parameters and tool
output are redacted and the home directory is masked. Each fixture carries a
`truth` label computed from the raw run, never from the plugin's renderer.

The fixtures are not committed, because they still name local projects and paths.
Rebuild the `live-*` ones after adding a capture:

```
node evals/build-fixtures.mjs
```
