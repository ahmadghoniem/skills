---
name: opencode
description: |
  Delegate an approved plan to opencode. Trigger when the user says "delegate to opencode", "hand this to opencode", "use opencode to implement this", or "run this through opencode" — typically after a planning session. Claude takes the plan as-is (drafted normally, for a human to read), translates it into opencode-ready tasks, queries the live model list to pick a model, runs opencode, then verifies the result against the plan.
allowed-tools: Bash, Read, Glob, Grep
argument-hint: The approved plan or task to delegate to opencode
---

# Opencode Delegation

The idea: plan normally with the user — a plain, human-readable plan. When the user says **"delegate to opencode"**, this skill fires. Claude then **translates** the approved plan into opencode-ready tasks and runs it. Plans are written for the user to review; opencode-shaping happens at delegation time, not before.

Read the **opencode task spec** below before translating anything.

---

## The opencode task spec

Opencode runs headless — no questions mid-run. It fills every gap with its own guess. So each task must be unambiguous.

A good opencode task has:

1. **Stack context** — language, framework, and the files this task touches. Not the whole repo.
2. **One objective** — a single imperative. Never "do X and also Y."
3. **Exact file paths** — `src/auth/session.ts`, not "the auth module." Verify each path exists.
4. **Explicit constraints** — anything that must not change. Unstated = opencode may change it.
5. **A grep-based VERIFY** — never a file re-read.

### Template

```
Stack: <language/framework>. Key files: <file1>, <file2>.

TASK: <single imperative, one sentence>

CONSTRAINTS:
- <what must not change>
- <conventions to follow — point at a file to read if needed>

VERIFY: grep for "<symbol or string>" in <file> and confirm it exists.
```

### Rules

- One task = one prompt.
- Name exact files. If a task defines a function, include its signature in the TASK line.
- Write constraints explicitly — public APIs, test structure, import style.
- VERIFY with grep (`grep -n "def foo" file.py`), not "read the file and check."
- English prompts — best model performance.

### Bad vs good

❌ `Fix the API, add a classifier, update the UI with badges` — three tasks, no paths, no verify.

✅
```
Stack: Python/Flask. Key files: app.py

TASK: In fetch_data() in app.py, convert the date string ("YYYY-MM-DD")
to datetime.date before returning.

CONSTRAINTS:
- Keep the existing route structure unchanged
- Match the import style already in app.py

VERIFY: grep for "datetime.date" in app.py and confirm it exists.
```

---

## The flow

### 1. Take the plan

The plan is whatever the user just approved — pasted in chat, written by Claude this session, or a file path. If it's a file path, verify it exists. If you don't have a concrete plan, ask for it before proceeding.

### 2. Translate to opencode tasks

Convert the plan into one or more tasks conforming to the spec above. While translating:

- **Verify every file path** against the repo (Glob/Read). Fix or drop wrong paths.
- **Add VERIFY criteria** the plan didn't include.
- **Make constraints explicit** — anything the plan implied but didn't state.

Write the translated tasks to `.claude/plans/<slug>.md` (create the dir if needed). That file is what opencode receives via `-f` — it must be canonical.

### 3. Decide: one call or decompose

| Signal | Decision |
|--------|----------|
| 1–3 files, single goal | One opencode call |
| >3 files, multi-step logic, or multiple distinct tasks | Decompose into sequential sub-tasks |

For decomposed runs: check `git diff` after each sub-task before the next. Surface unexpected changes.

### 4. Preflight

```bash
opencode --version
opencode auth list
git rev-parse --show-toplevel
```

- Not found → tell the user to install from https://opencode.ai. Stop.
- No authed providers → tell the user to run `opencode auth login`. Stop.
- Not a git repo → verification can't use `git diff`; fall back to reading the changed files directly. Tell the user this once.

Use the git root (or the user's intended project dir) as the `--dir` value in step 7.

### 5. Pick model

**If a model was already chosen earlier in this conversation, reuse it silently — don't ask again.** The choice persists for the whole session; a new session starts fresh.

Otherwise, pick live:

1. Run `opencode models` (no provider argument — querying one provider hides models available under others). If the list looks short, run `opencode models --refresh` and retry.
2. Present the returned models via `AskUserQuestion`. Options are the literal `provider/model` strings only — no editorial commentary, no "recommended," no guessing at behavior. Never list models from memory; only what the command returned.
3. Remember the choice for the rest of this conversation so later delegations skip this step.

`opencode/deepseek-v4-flash-free` is a reasonable free pick to surface first, but it's just one option in the live list — not a hardcoded default.

### 6. Confirm permissions

Ask with `AskUserQuestion`: "What should opencode be allowed to do?"

- **Implement** (default) — `OPENCODE_PERMISSION='{"edit":"allow","bash":"allow","webfetch":"allow"}'`
- **Implement, no shell** — `OPENCODE_PERMISSION='{"edit":"allow","bash":"deny","webfetch":"allow"}'`
- **Read-only** — `OPENCODE_PERMISSION='{"edit":"deny","bash":"deny","webfetch":"allow"}'`

Never use `"ask"` — opencode can't prompt mid-run and will block.

### 7. Run

```bash
OPENCODE_PERMISSION='<preset>' \
  opencode run \
  -m <chosen model> \
  --dir <project dir from preflight> \
  --title "<short task description>" \
  -f .claude/plans/<slug>.md \
  "Implement the plan in the attached file exactly as written. Do not redesign. If you hit an ambiguity, follow the closest existing pattern in the repo. Report what you did and any deviations."
```

**Argument order is load-bearing.** The prompt is the last argument. Every `-f` is immediately followed by a real path — never a placeholder, or you get `File not found: <prompt text>`.

**Capture the session ID** from the run output (or `opencode session list -n 1`) so you can report it and resume if needed.

**Timeouts** (pass explicitly): 1–2 files → `600000`; 3–8 files → `1800000`; repo-wide → `3600000`. If the user's `BASH_MAX_TIMEOUT_MS` cap (default 10 min) is too low for the task, tell them to raise it.

**If opencode returns before finishing**, don't take over — resume the session:
```bash
opencode run -m <same model as the run> -c "The last run ended with <reason>. Fix it."
```

### 8. Verify

- **Read the git diff** — files match the plan's list?
- **Check plan completion** — each task addressed? Flag gaps.
- **Flag unexpected changes** — anything outside the plan, shown with the diff.

Report: what opencode did (1–2 sentences), plan adherence, unexpected changes, session ID, next step (accept / resume / `git checkout .` to revert).

---

## Edge cases

| Situation | Action |
|-----------|--------|
| Plan references a file that doesn't exist | Find the right path or drop it; tell the user |
| Exit 0 but `git diff` empty (WROTE_NOTHING) | Don't retry blindly — surface output, ask to reword or fix manually |
| Run returns with no diff and no error | Likely a free-model queue delay or no-op. Retry once, or switch model |
| Sub-task touches files outside its scope | Pause, show diff, ask whether to continue |
| Timed out mid-task | ≥50% done → finish manually; <50% → decompose further, relaunch |
| 3 failed attempts on a sub-task | Escalate to the user — don't loop silently |
