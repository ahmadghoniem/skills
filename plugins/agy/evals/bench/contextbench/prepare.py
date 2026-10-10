"""Pick a ContextBench pilot set, check each repo out at its base commit, and write a tasks file.

    python prepare.py --gold contextbench_verified.parquet --repos /opt/bench/cb --out tasks.json [--n 20] [--seed 1]

The sample is spread across languages in proportion to the subset, with at
least one task per language. Each repo is fetched at the base commit only
(depth 1), so the agent cannot find the fix in later history.
"""

import argparse
import json
import os
import subprocess

import pandas as pd

BRIEF = """READ-ONLY lookup. Do not modify any file, and do not run tests or install anything.

Repo root: {REPO}

Below is an issue reported against this repository. Find the code a developer must read to fix it: the code that has to change, and the code needed to understand that change (callers, definitions, related checks). Do not write the fix.

Reply with a short explanation, then end with this block, one range per line, paths relative to the repo root, ranges as tight as you can make them:

<CONTEXT>
path/to/file.ext:START-END
</CONTEXT>

--- ISSUE ---
"""


def pick(df, n, seed):
    share = df.language.value_counts(normalize=True)
    quota = {lang: max(1, round(p * n)) for lang, p in share.items()}
    # Trim the largest buckets until the total is n.
    while sum(quota.values()) > n:
        quota[max(quota, key=quota.get)] -= 1
    parts = [df[df.language == lang].sample(k, random_state=seed) for lang, k in quota.items()]
    return pd.concat(parts)


def fetch(repo_url, commit, dest):
    if os.path.isdir(os.path.join(dest, ".git")):
        return
    os.makedirs(dest, exist_ok=True)
    git = lambda *a: subprocess.run(["git", "-C", dest, *a], check=True, capture_output=True)
    git("init", "-q")
    git("remote", "add", "origin", repo_url)
    git("fetch", "-q", "--depth", "1", "origin", commit)
    git("checkout", "-q", "FETCH_HEAD")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gold", required=True)
    ap.add_argument("--repos", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()

    df = pd.read_parquet(a.gold)
    tasks = []
    for _, r in pick(df, a.n, a.seed).iterrows():
        dest = os.path.join(os.path.abspath(a.repos), r.instance_id)
        print(f"{r.instance_id}  {r.repo}@{r.base_commit[:10]}", flush=True)
        fetch(r.repo_url, r.base_commit, dest)
        tasks.append({
            "id": r.instance_id,
            "repo": dest,
            "repo_url": r.repo_url,
            "commit": r.base_commit,
            "language": r.language,
            "brief": BRIEF + r.problem_statement,
        })
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"tasks": tasks}, f, indent=1)
    print(f"{len(tasks)} tasks -> {a.out}")


if __name__ == "__main__":
    main()
