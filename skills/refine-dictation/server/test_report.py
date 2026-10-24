"""The log, the report data and the report's endpoints, without the GPU.

    C:\\stt-bench\\.venv\\Scripts\\python.exe test_report.py

Runs against a temporary STT_HOME, so your own rules and log are not touched.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

# Before the imports below: home.py reads STT_HOME once, when it is first imported.
os.environ["STT_HOME"] = tempfile.mkdtemp(prefix="stt-test-")

from fastapi.testclient import TestClient  # noqa: E402

import corrections  # noqa: E402
import dictlog  # noqa: E402
import report  # noqa: E402
from fastapi import FastAPI  # noqa: E402

RULES = [
    {"from": "REDME", "to": "README", "added": "2026-01-01", "test": ["open the REDME", "open the README"]},
    {"from": "rebel(s?)\\b", "to": "repo\\1", "type": "regex", "added": date.today().isoformat(), "test": ["both rebels", "both repos"]},
    {"from": "Guntha", "to": "Gantt", "added": date.today().isoformat(), "on": False, "test": ["a Guntha chart", "a Gantt chart"]},
]

failures: list[str] = []


def expect(name: str, got, want) -> None:
    if got != want:
        failures.append(f"{name}\n    want {want!r}\n    got  {got!r}")


def log(raw: str) -> str:
    text, fixes = corrections.apply_traced(raw)
    return dictlog.append(raw, text, fixes, 1.0)


def main() -> int:
    corrections.save_rules(RULES)

    # Rules: fixes carry offsets into the raw text; a rule that is off does nothing.
    text, fixes = corrections.apply_traced("read the REDME in both rebels, then the Guntha chart")
    expect("apply", text, "read the README in both repos, then the Guntha chart")
    expect("fix offsets", [(f["start"], f["end"], f["to"], f["rule"]) for f in fixes],
           [(9, 14, "README", "REDME"), (23, 29, "repos", "rebel(s?)\\b")])

    # The log: dictations, reply fixes on a second line, and the 90-day cut.
    first = log("read the REDME first")
    log("clone both rebels")
    dictlog.add_reply_fixes(first, [{"from": "first", "to": "1st"}])
    with dictlog.LOG_FILE.open("a", encoding="utf-8") as f:
        old = (datetime.now() - timedelta(days=91)).isoformat(timespec="seconds")
        f.write(json.dumps({"id": "1", "at": old, "raw": "old", "text": "old", "fixes": [], "seconds": 1}) + "\n")
    entries = dictlog.entries()
    expect("entries", [e["raw"] for e in entries], ["read the REDME first", "clone both rebels"])
    expect("reply merged", entries[0]["reply"], [{"from": "first", "to": "1st"}])
    dictlog.prune()
    expect("prune", sum(1 for _ in dictlog.LOG_FILE.open(encoding="utf-8")), 3)

    # Report data: REDME is older than this week, the rebel rule is new.
    data = report.build()
    expect("stats", data["stats"], {"dictations": 2, "words": 7, "rule_fixes": 2, "reply_fixes": 1,
                                     "points": 28.57, "points_old": 14.29})
    rows = {r["from"]: r for r in data["rules"]}
    expect("week count", rows["REDME"]["week"], 1)
    expect("off", rows["Guntha"]["on"], False)
    expect("recent newest first", [e["raw"] for e in data["recent"]], ["clone both rebels", "read the REDME first"])

    # Endpoints.
    app = FastAPI()
    app.include_router(report.router)
    client = TestClient(app)
    expect("page", client.get("/report").status_code, 200)

    r = client.post("/report/rules/update", json={"from": "Guntha", "on": True})
    expect("turn on", "on" in r.json()["rule"], False)

    r = client.post("/report/rules/update", json={"from": "REDME", "pattern": "REDMEE"})
    expect("pattern that fails its test is refused", r.status_code, 400)
    r = client.post("/report/rules/update", json={"from": "REDME", "pattern": "RED ?ME"})
    expect("narrow", r.json()["rule"]["type"], "regex")
    expect("narrowed rule applies", corrections.apply("the RED ME file"), "the README file")

    r = client.post("/report/rules/delete", json={"from": "Guntha"})
    removed = r.json()
    expect("delete", [x["from"] for x in corrections.load_rules()], ["RED ?ME", "rebel(s?)\\b"])
    client.post("/report/rules/add", json=removed)
    expect("undo delete", [x["from"] for x in corrections.load_rules()], ["RED ?ME", "rebel(s?)\\b", "Guntha"])

    r = client.post(f"/log/{first}/reply", json={"fixes": [{"from": "read", "to": "Read"}]})
    expect("reply endpoint", r.status_code, 200)
    expect("reply to unknown id", client.post("/log/nope/reply", json={"fixes": []}).status_code, 404)
    expect("log endpoint", [e["raw"] for e in client.get("/log?last=1").json()], ["clone both rebels"])

    # Unused rules: 61 days from now, none has fixed a word for more than 60.
    gone = corrections.remove_unused(dictlog.entries(), today=date.today() + timedelta(days=61))
    expect("unused removed", sorted(r["from"] for r in gone), ["Guntha", "RED ?ME", "rebel(s?)\\b"])
    expect("removed kept on file", len(Path(corrections.REMOVED_FILE).read_text(encoding="utf-8").splitlines()), 3)

    if failures:
        print(f"FAIL ({len(failures)})\n")
        for f in failures:
            print(f"  {f}\n")
        return 1
    print("ok - report")
    return 0


if __name__ == "__main__":
    sys.exit(main())
