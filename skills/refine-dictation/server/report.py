"""The report page at /report, its data, and the endpoints its buttons call.

Also /log, which /refine-dictation uses to find the raw text of a dictation and to
record the fixes it made in a reply.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Body
from fastapi.responses import FileResponse, JSONResponse

import corrections
import dictlog

router = APIRouter()
PAGE = Path(__file__).with_name("report.html")
RECENT = 60


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": message})


def build(now: datetime | None = None) -> dict:
    now = now or datetime.now()
    week_start = now - timedelta(days=7)
    log = dictlog.entries()
    rules = corrections.load_rules()
    added = {r["from"]: date.fromisoformat(r.get("added", now.date().isoformat())) for r in rules}

    week = [e for e in log if datetime.fromisoformat(e["at"]) >= week_start]
    words = sum(len(e["raw"].split()) for e in week)
    rule_fixes = [f for e in week for f in e["fixes"]]
    # A rule deleted since has no added date; count its fixes as an older rule's.
    old_fixes = [f for f in rule_fixes if added.get(f["rule"], date.min) < week_start.date()]

    def points(n: int) -> float:
        return round(n / words * 100, 2) if words else 0.0

    rows = []
    for r in rules:
        fires = [e["at"] for e in log for f in e["fixes"] if f["rule"] == r["from"]]
        recent_fires = [a for a in fires if datetime.fromisoformat(a) >= week_start]
        removes_on = corrections.last_used(r, log) + timedelta(days=corrections.UNUSED_DAYS + 1)
        rows.append({
            "from": r["from"],
            "to": r["to"],
            "regex": r.get("type") == "regex",
            "on": r.get("on", True),
            "week": len(recent_fires),
            "total": len(fires),
            "last": max(fires)[:10] if fires else None,
            "added": r.get("added"),
            "removes_on": removes_on.isoformat(),
            "flag": r.get("flag"),
        })

    return {
        "now": now.isoformat(timespec="seconds"),
        "week_start": week_start.date().isoformat(),
        "stats": {
            "dictations": len(week),
            "words": words,
            "rule_fixes": len(rule_fixes),
            "reply_fixes": sum(len(e["reply"]) for e in week),
            "points": points(len(rule_fixes)),
            "points_old": points(len(old_fixes)),
        },
        "rules": rows,
        "recent": [
            {k: e[k] for k in ("id", "at", "raw", "fixes", "reply")}
            for e in reversed(log[-RECENT:])
        ],
        # Every dictation's raw text, so a pattern can be tried against 90 days in the page.
        "log": [{"at": e["at"], "raw": e["raw"]} for e in log],
    }


@router.get("/report")
def page():
    return FileResponse(PAGE, media_type="text/html")


@router.get("/report/data")
def data():
    return build()


@router.post("/report/rules/update")
def update_rule(body: dict = Body(...)):
    key = body.get("from")

    def change(rule: dict) -> None:
        if "on" in body:
            rule["on"] = bool(body["on"])
            if rule["on"]:
                rule.pop("on")
        if "pattern" in body:
            pattern = str(body["pattern"])
            if not pattern.strip():
                raise ValueError("The pattern is empty.")
            rule["from"] = pattern
            if corrections.is_regex(pattern):
                rule["type"] = "regex"
            else:
                rule.pop("type", None)
        if "flag" in body and body["flag"] is None:
            rule.pop("flag", None)

    try:
        return {"rule": corrections.update(key, change)}
    except KeyError:
        return _error(404, "That rule no longer exists. Reload the page.")
    except ValueError as exc:
        return _error(400, str(exc))


@router.post("/report/rules/delete")
def delete_rule(body: dict = Body(...)):
    rules = corrections.load_rules()
    index = next((i for i, r in enumerate(rules) if r["from"] == body.get("from")), None)
    try:
        return {"rule": corrections.delete(body.get("from")), "index": index}
    except KeyError:
        return _error(404, "That rule no longer exists. Reload the page.")


@router.post("/report/rules/add")
def add_rule(body: dict = Body(...)):
    try:
        corrections.add(body["rule"], body.get("index"))
        return {"ok": True}
    except ValueError as exc:
        return _error(400, str(exc))


@router.get("/log")
def recent_log(last: int = 5):
    """The newest dictations, newest first, for /refine-dictation."""
    return [
        {k: e[k] for k in ("id", "at", "raw", "text", "fixes", "reply")}
        for e in reversed(dictlog.entries()[-last:])
    ]


@router.post("/log/{entry_id}/reply")
def reply_fixes(entry_id: str, body: dict = Body(...)):
    fixes = body.get("fixes") or []
    if not all(isinstance(f, dict) and f.get("from") and "to" in f for f in fixes):
        return _error(400, "Each fix needs `from` and `to`.")
    if not any(e["id"] == entry_id for e in dictlog.entries()):
        return _error(404, "No dictation with that id in the last 90 days.")
    dictlog.add_reply_fixes(entry_id, fixes)
    return {"ok": True}
