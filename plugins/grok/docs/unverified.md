# Unverified claims

Hypotheses about grok's behaviour that have not been confirmed by a live run.
Each one states its test. Run the test first; only then change the code.

**Verified against:** grok 1.0.52 (`engines.grok` in `package.json`).

**When a claim is settled, delete its section from this file** and record the
outcome in `CHANGELOG.md`. A file of stale hypotheses is worse than no file.

Plan mode and release notes were settled in 0.5.0; see the CHANGELOG.

---

## 1. `--worktree` is not passed, and the risk is therefore theoretical

**Severity if true:** none today. Recorded so it is not rediscovered as a bug.

Research flagged that `-w`/`--worktree` writes to `~/.grok/worktrees/…` rather
than the repo. `buildArgs` never emits it and there is no flag path that would,
so this cannot happen through the plugin as written.

It matters only as a constraint on future work: if `--worktree` is ever added as
a delegation option, it needs a story for getting the changes back, and the
post-run `git status` comparison would need to look somewhere else entirely.

No test. Do not act.

---

## Settled — no live run needed

- **`--no-auto-update` is correct and must not be "cleaned up."** It does not
  appear in `grok --help` on 1.0.52, and live runs accept it (exit 0). It is
  documented at `docs.x.ai/build/cli/headless-scripting` for headless use. A
  `--help` diff would call it removed and be wrong.
