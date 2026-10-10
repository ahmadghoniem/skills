"""Edit-site recall: how much of the gold fix's location the predicted context covers.

    python editsites.py --gold contextbench_verified.parquet --run <dir> --arm stock|custom

Writes <run>/edits.<arm>.jsonl. ContextBench's own EditLoc metric scores a
model's patch, and with no patch it falls back to the gold patch, so it is the
same for every agent here; this replaces it. The gold sites are the old-file
lines the fix removes or changes, plus the line each pure insertion follows.
"""

import argparse
import json
import os
import re

import pandas as pd

HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@")


def edit_sites(patch):
    """{path: set(old line numbers)} from a unified diff.

    Lines are read as hunk content while the hunk's line counts last, so a
    removed line that itself starts with "-- " is not taken for a file header.
    """
    sites = {}
    path = None
    old = 0
    old_left = new_left = 0
    for line in patch.splitlines():
        if old_left > 0 or new_left > 0:
            tag = line[:1]
            if tag == "-":
                sites.setdefault(path, set()).add(old)
                old += 1
                old_left -= 1
            elif tag == "+":
                sites.setdefault(path, set()).add(max(old - 1, 1))
                new_left -= 1
            elif tag in (" ", ""):
                old += 1
                old_left -= 1
                new_left -= 1
            continue
        if line.startswith("--- "):
            p = line[4:].split("\t")[0].strip()
            path = None if p == "/dev/null" else re.sub(r"^a/", "", p)
            continue
        if line.startswith("+++ "):
            if path is None:
                path = re.sub(r"^b/", "", line[4:].split("\t")[0].strip())
            continue
        m = HUNK.match(line)
        if m and path is not None:
            old = int(m.group(1))
            old_left = int(m.group(2) if m.group(2) is not None else 1)
            new_left = int(m.group(3) if m.group(3) is not None else 1)
    return sites


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gold", required=True)
    ap.add_argument("--run", required=True)
    ap.add_argument("--arm", required=True, choices=["stock", "custom"])
    a = ap.parse_args()

    gold = pd.read_parquet(a.gold, columns=["instance_id", "patch"]).set_index("instance_id")["patch"]
    preds = os.path.join(a.run, f"preds.{a.arm}.jsonl")
    rows = []
    with open(preds, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            p = json.loads(line)
            sites = edit_sites(gold.get(p["instance_id"], "") or "")
            spans = p["traj_data"]["pred_spans"]
            total = sum(len(v) for v in sites.values())
            hit = sum(
                1
                for path, lines in sites.items()
                for n in lines
                if any(s["start"] <= n <= s["end"] for s in spans.get(path, []))
            )
            files_hit = sum(1 for path in sites if path in spans)
            pred_lines = sum(s["end"] - s["start"] + 1 for v in spans.values() for s in v)
            rows.append({
                "instance_id": p["instance_id"],
                "edit_lines": total,
                "edit_lines_covered": hit,
                "edit_recall": hit / total if total else 0.0,
                "edit_files": len(sites),
                "edit_file_recall": files_hit / len(sites) if sites else 0.0,
                "pred_lines": pred_lines,
            })
    out = os.path.join(a.run, f"edits.{a.arm}.jsonl")
    with open(out, "w", encoding="utf-8") as f:
        f.writelines(json.dumps(r) + "\n" for r in rows)
    n = len(rows) or 1
    print(f"{out}: {len(rows)} tasks, edit-line recall {sum(r['edit_recall'] for r in rows) / n:.3f}, "
          f"edit-file recall {sum(r['edit_file_recall'] for r in rows) / n:.3f}")


if __name__ == "__main__":
    main()
