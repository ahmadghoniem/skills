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
  ```
  The defaults already cover `*.googleapis.com` and `accounts.google.com`.
- **Setup script:** the contents of `cloud-setup.sh`.

Start the session on this repo's `agy-chore` branch.

## Part B: first-session checks

For the Claude driving the session. Each step names what it confirms; stop and
report if one fails. Each Bash call is a fresh shell, so start agy commands with
`. /tmp/agy-keyring.env &&`.

1. **Install.** `agy --version` and `ls /opt/bench/plannotator` both work.
2. **Keyring.** `bash plugins/agy/evals/bench/keyring.sh`.
3. **Sign-in.** agy's first screen is a login menu with "1. Google OAuth" selected;
   Enter shows a sign-in URL and an "authorization code" field. agy takes about
   10 s to draw each screen, so wait that long before each of the last two commands:
   ```
   tmux new-session -d -s login -x 250 -y 50 ". /tmp/agy-keyring.env && agy"
   tmux send-keys -t login Enter
   tmux capture-pane -p -J -t login
   ```
   agy wraps the URL over several lines itself; join them with no spaces. Send the
   user the URL, wait for the code they paste back, then
   `tmux send-keys -t login '<code>' Enter` and capture the pane again to confirm
   the sign-in. Quit agy and kill the tmux session. Then confirm the sign-in was
   stored: a new `agy` in tmux must open without the login menu.
4. **Headless run, run_command's shell, path-less rg.** From `plugins/agy`:
   ```
   . /tmp/agy-keyring.env && node evals/bench/run.mjs --arm stock \
     --tasks evals/bench/tasks/smoke.json --repo /opt/bench/plannotator \
     --out /tmp/bench/probe --only shell-probe,stall-probe --timeout 180 --workers 2
   ```
   Report for each probe the `report`, `answeredAt` and `wall`. A `wall` far
   past `answeredAt` in stall-probe means path-less `rg` still hangs on Linux.
5. **Both arms, one task.**
   ```
   . /tmp/agy-keyring.env && node evals/bench/run.mjs --arm custom \
     --tasks evals/bench/tasks/smoke.json --repo /opt/bench/plannotator \
     --out /tmp/bench/smoke --only share --timeout 600
   ```
   and the same with `--arm stock`. Report wall time, status and tool calls, and
   whether each report cites `path:line`.
6. **Kill.** The custom arm with `--timeout 20` and a new `--out`. agy must be
   stopped near 20 s, and `pgrep -af 'agy|bash.mjs'` afterwards must list nothing
   from the run.
7. **Sign out.** At the end of the session, `agy` then `/logout`.
