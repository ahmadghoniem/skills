# agy benchmark: stock agy against the agy-chore agent

`run.mjs` runs one arm over a tasks file: `stock` (agy's default agent and
tools) or `custom` (`delegate.mjs --chore`: the agy-chore agent with the
plugin's bash tool). Results go to `<out>/<task>.<arm>.json`, with `wall`
(seconds until the process exited) and, for stock, `answeredAt` (seconds until
agy's result event).

## Cloud environment (Claude Code on the web)

One-time, at claude.ai/code > environment settings:

- **Network access: Custom**, with "include default allowed domains" on, plus:
  ```
  antigravity.google
  antigravity.google.com
  antigravity-cli-auto-updater-974169037036.us-central1.run.app
  lh3.googleusercontent.com
  ```
  The defaults already cover `*.googleapis.com` and `accounts.google.com`.
  Without `lh3.googleusercontent.com`, agy's account check fails fetching the
  profile picture: a warning in the TUI, but headless runs exit on it.
- **Setup script:** the contents of `cloud-setup.sh`.

Start the session on this repo's `agy-chore` branch.

## Part B: first-session checks

For the Claude driving the session. Each step names what it confirms; stop and
report if one fails. Each Bash call is a fresh shell, so start agy commands with
`. /tmp/agy-keyring.env &&`.

1. **Install.** `agy --version` and `ls /opt/bench/plannotator` both work.
2. **Keyring.** `bash plugins/agy/evals/bench/keyring.sh`.
3. **Sign-in.** agy's first screen is a login menu with "1. Google OAuth" selected;
   Enter shows a sign-in URL and an "authorization code" field. Wait a few seconds
   for each screen before the last two commands:
   ```
   tmux new-session -d -s login -x 250 -y 50 ". /tmp/agy-keyring.env && agy"
   tmux send-keys -t login Enter
   tmux capture-pane -p -J -t login
   ```
   agy wraps the URL over several lines itself; join them with no spaces. Send the
   user the URL, wait for the code they paste back, then
   `tmux send-keys -t login '<code>' Enter` and capture the pane again. Three
   screens follow: colour scheme (Enter), Terms (Enter only toggles a checkbox;
   reach `[Done]` with Down then Right, and leave the data-sharing box unticked
   unless the user says otherwise), and folder trust (Yes). Quit with `/quit` and
   kill the tmux session. Then confirm the sign-in was stored: a new `agy` in tmux
   must open without the login menu.
   If the container restarts, the keyring daemon dies and agy asks to sign in
   again; re-run `keyring.sh` and the stored sign-in comes back.
4. **Plugin setup.** From `plugins/agy`: `. /tmp/agy-keyring.env && node scripts/setup.mjs`.
   It installs the bash tool in `~/.gemini/config/mcp_config.json`; the custom arm
   refuses to run without it.
5. **Headless run, run_command's shell, path-less rg.** From `plugins/agy`:
   ```
   . /tmp/agy-keyring.env && node evals/bench/run.mjs --arm stock \
     --tasks evals/bench/tasks/smoke.json --repo /opt/bench/plannotator \
     --out /tmp/bench/probe --only shell-probe,stall-probe --timeout 180 --workers 2
   ```
   Report for each probe the `report`, `answeredAt` and `wall`. A `wall` far
   past `answeredAt` in stall-probe means path-less `rg` still hangs on Linux.
6. **Both arms, one task.**
   ```
   . /tmp/agy-keyring.env && node evals/bench/run.mjs --arm custom \
     --tasks evals/bench/tasks/smoke.json --repo /opt/bench/plannotator \
     --out /tmp/bench/smoke --only share --timeout 600
   ```
   and the same with `--arm stock`. Report wall time, status and tool calls, and
   whether each report cites `path:line`.
7. **Kill.** The custom arm with `--timeout 20` and a new `--out`. agy must be
   stopped near 20 s, and `pgrep -af 'agy|bash.mjs'` afterwards must list nothing
   from the run.
8. **Sign out.** At the end of the session, `agy` then `/logout`.

## Part C: ContextBench pilot

[ContextBench](https://github.com/anonymousUser2026/ContextBench) scores how much
of the code needed for a fix an agent found (coverage) and how much of what it
returned was needed (precision), at file, symbol and line-span level. The pilot
takes 20 tasks from its 500-task verified subset, spread across languages, and
runs both arms three times. Each brief asks for the context only, ending in a
`<CONTEXT>` block of `path:start-end` lines; `contextbench/score.mjs` turns those
blocks into the evaluator's input. Only the final context is scored, so the
evaluator's trajectory metrics (AUC-coverage, redundancy) don't apply.

Network: the default allowed domains must reach `huggingface.co` and its file
CDN for the parquet; if the download is blocked, report the host it was
redirected to.

1. **Python 3.11 and the evaluator.** Its `tree-sitter-languages` pin has no
   wheels past 3.11.
   ```
   uv venv -p 3.11 /opt/cbenv
   git clone -q --depth 1 https://github.com/anonymousUser2026/ContextBench /opt/cb-eval
   uv pip install -p /opt/cbenv -r /opt/cb-eval/Context-Bench/requirements.txt pandas
   curl -fsSL -o /opt/cb-eval/verified.parquet \
     https://huggingface.co/datasets/Contextbench/ContextBench/resolve/main/data/contextbench_verified.parquet
   ```
2. **Tasks and repos.** From `plugins/agy/evals/bench/contextbench`:
   ```
   /opt/cbenv/bin/python prepare.py --gold /opt/cb-eval/verified.parquet --repos /opt/bench/cb --out /tmp/cb/tasks.json
   ```
3. **Runs.** From `plugins/agy`, one arm at a time:
   ```
   for r in 1 2 3; do for a in stock custom; do
     . /tmp/agy-keyring.env && node evals/bench/run.mjs --arm $a --tasks /tmp/cb/tasks.json \
       --out /tmp/cb/r$r --workers 3 --timeout 900
   done; done
   ```
   A run that fails with a quota error prints `QUOTA - stopping`; rerunning the
   same command resumes. Check what is left with `agy -p "/usage"`, which prints
   the weekly and 5-hour Gemini limits and when each resets.
4. **Score.** From `plugins/agy/evals/bench/contextbench`, for each run and arm:
   ```
   node score.mjs pred --tasks /tmp/cb/tasks.json --run /tmp/cb/r1 --arm stock
   (cd /opt/cb-eval/Context-Bench && /opt/cbenv/bin/python -m contextbench.evaluate \
     --gold /opt/cb-eval/verified.parquet --pred /tmp/cb/r1/preds.stock.jsonl \
     --cache /opt/cb-cache --out /tmp/cb/r1/eval.stock.jsonl)
   ```
   and `/opt/cbenv/bin/python editsites.py --gold /opt/cb-eval/verified.parquet --run /tmp/cb/r1 --arm stock`,
   then `node score.mjs report --tasks /tmp/cb/tasks.json --run /tmp/cb/r1 --run /tmp/cb/r2 --run /tmp/cb/r3`.
   The evaluator's EditLoc numbers are not used: with no model patch it scores
   the gold patch, so they come out the same for both arms. `editsites.py`
   measures instead how many of the lines the real fix changes fall inside the
   predicted context.

## Results (October 2026)

20 tasks, 3 runs per arm, `gemini-3.7-flash-low`:

| arm | file F1 | symbol F1 | span F1 | turns mean / median / max | wall mean / median / max |
|---|---|---|---|---|---|
| stock | .692 | .519 | .488 | 10.0 / 9 / 24 | 20 / 17 / 43 s |
| `agy-chore` | .753 | .564 | .505 | 13.4 / 10 / 47 | 42 / 28 / 306 s |

`agy-chore` cites the right files more often (file precision .748 against
.704) at about the same number of turns. Its turns are longer (2.2 to 2.9 s of
model time against 1.7 s), because it reads more file content. Most of its
wall-time mean and the 306 s maximum come from `8d2ac221` (vuejs/core), where
the model looks up commits the issue names in a one-commit clone; on a later
day, on 10 of the tasks, `agy-chore` averaged 10.8 turns and 24 s.

Model comparison, `agy-chore` on 10 of the tasks, rounds run on the same day:

| model | turns mean | wall mean / max | median model time per turn | thinking tokens per turn | file F1 | runs that executed code |
|---|---|---|---|---|---|---|
| 3.7 flash low | 10.8 | 24 / 54 s | 1.77 s | 0 | .783 | 0 of 30 |
| 3.8 flash medium | 26.6 | 105 / 357 s | 2.03 s | 281 | .659 | 3 of 20 |
| 3.8 flash high | 36.6 | 242 / 478 s | 2.95 s | 676 | .620 | 3 of 10 |

3.8 finds more of the gold context (fix-site line recall .87 to .88 against
.83) but cites 3 to 4 files instead of 2, so precision and F1 fall. A 3.8
round used 8 to 18 points of the 5-hour quota, a 3.7 flash low round 5.

Other findings:
- The model makes one tool call per turn (see "One tool call per turn" in the
  plugin README). Prompts asking for parallel calls changed nothing, and a
  stronger one made runs slower.
- Turn time varies from day to day by up to 1.6x for the same prompt, so
  compare arms only in rounds run alternately on the same day.
- Sonnet 5.5 at low effort through `claude -p`, on 5 of the tasks, for
  reference: 2 to 11 turns, 11 s mean and 19 s maximum wall time, file F1
  .868. It streams about 130 tokens/s against about 490 for 3.7 flash low,
  and wins on turns: it makes parallel calls in about half its tool turns.
