"""The dictation log: every transcript, before and after the rules, for 90 days.

~/.stt/dictations.jsonl, one JSON object per line. A dictation:

    {"id": "1792800191123", "at": "2026-10-24T03:14:51", "raw": "...", "text": "...",
     "fixes": [{"start": 12, "end": 21, "to": "Hypermark", "rule": "Hibermark"}], "seconds": 6.4}

`fixes` are the rule fixes, with `start`/`end` as offsets into `raw`. When
/refine-dictation fixes words that no rule covers, it appends a second line:

    {"reply": "1792800191123", "fixes": [{"from": "urban items", "to": "open items"}]}

Lines are only ever appended, except by prune(), which rewrites the file without
the lines older than KEEP_DAYS.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import date, datetime, timedelta

from home import HOME

LOG_FILE = HOME / "dictations.jsonl"
KEEP_DAYS = 90

_lock = threading.Lock()
_last_id = 0


def _append(record: dict) -> None:
    with _lock:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def append(raw: str, text: str, fixes: list[dict], seconds: float) -> str:
    # Milliseconds, bumped when two dictations land in the same one.
    global _last_id
    with _lock:
        _last_id = max(time.time_ns() // 1_000_000, _last_id + 1)
        entry_id = str(_last_id)
    _append({
        "id": entry_id,
        "at": datetime.now().isoformat(timespec="seconds"),
        "raw": raw,
        "text": text,
        "fixes": fixes,
        "seconds": round(seconds, 2),
    })
    return entry_id


def add_reply_fixes(entry_id: str, fixes: list[dict]) -> None:
    _append({"reply": entry_id, "fixes": [{"from": f["from"], "to": f["to"]} for f in fixes]})


def _lines() -> list[dict]:
    try:
        text = LOG_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        return []
    out = []
    for line in text.splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue  # a line cut off by a crash mid-write
    return out


def entries() -> list[dict]:
    """Dictations of the last KEEP_DAYS, oldest first, each with `reply` fixes and `day` added."""
    cutoff = datetime.now() - timedelta(days=KEEP_DAYS)
    by_id: dict[str, dict] = {}
    for rec in _lines():
        if "reply" in rec:
            if rec["reply"] in by_id:
                by_id[rec["reply"]]["reply"].extend(rec["fixes"])
        elif datetime.fromisoformat(rec["at"]) >= cutoff:
            by_id[rec["id"]] = {**rec, "reply": [], "day": date.fromisoformat(rec["at"][:10])}
    return list(by_id.values())


def prune() -> None:
    keep_ids = {e["id"] for e in entries()}
    with _lock:
        lines = _lines()
        kept = [r for r in lines if r.get("id", r.get("reply")) in keep_ids]
        if len(kept) == len(lines):
            return
        tmp = LOG_FILE.with_suffix(".jsonl.tmp")
        tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in kept), encoding="utf-8")
        tmp.replace(LOG_FILE)
