"""Post-transcription text fixes.

Parakeet mishears very little. What it does do is write things in the wrong
*form* -- `gethub` for `github`, `get request` for `GET request` -- and those are
pure string substitutions that need no model to decide. This applies them, so the
fix reaches every client: Vowen, or anything else pointed here.

Rules live in ~/.stt/corrections.json, one object per line:

    {"from": "REDME", "to": "README", "added": "2026-10-23", "test": ["open the REDME first", "open the README first"]}

`type: "regex"` makes `from` a pattern, `on: false` keeps a rule without applying
it, and `flag` asks you to look at it on the report page. /refine-dictation writes
the file; the report page edits it too. The module works fine with it absent.

Numbers are deliberately absent from the rule set. The model already writes
"thirty two thousand" as 32,768, ordinals as 23rd and versions as 3.11.4.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import date, datetime, timedelta

from home import HOME

RULES_FILE = HOME / "corrections.json"
REMOVED_FILE = HOME / "removed.jsonl"
UNUSED_DAYS = 60

_write_lock = threading.Lock()
# (compiled alternation, [(pattern, replacement, rule key) per group], mtime when built)
_cache: tuple[re.Pattern | None, list[tuple[str, str, str]], float] = (None, [], -1.0)


def _body(rule: dict) -> str:
    src = rule["from"]
    body = src if rule.get("type") == "regex" else re.escape(src)
    # \b is wrong next to a non-word character -- it would refuse to match
    # ".env" or "--save-dev". Anchor only the edges that are word-ish.
    left = r"\b" if src[:1].isalnum() else ""
    right = r"\b" if src[-1:].isalnum() else ""
    return f"{left}{body}{right}"


def _compile(rules: list[dict]) -> tuple[re.Pattern | None, list[tuple[str, str, str]]]:
    """One alternation over every rule that is on, so applying them is a single pass.

    Longest source first: `get request` must win over any shorter rule that
    would otherwise consume its `get`.
    """
    usable = [r for r in rules if r.get("from") and r.get("to") is not None and r.get("on", True)]
    usable.sort(key=lambda r: len(r["from"]), reverse=True)
    if not usable:
        return None, []

    parts, table = [], []
    for rule in usable:
        body = _body(rule)
        # (?: ) keeps a rule's own groups from being renumbered by the ones
        # around it; the named group is what identifies which rule matched.
        parts.append(f"(?P<r{len(table)}>(?:{body}))")
        table.append((body, rule["to"], rule["from"]))
    return re.compile("|".join(parts), re.IGNORECASE), table


def _sub(pattern: re.Pattern | None, table: list, text: str) -> tuple[str, list[dict]]:
    """Apply the rules and say what changed: where in `text`, into what, by which rule."""
    if not pattern or not text:
        return text, []
    fixes: list[dict] = []

    def swap(m: re.Match) -> str:
        # Which alternative fired. Rules are named r0, r1, ... and only the one
        # that matched has a name on the match.
        for name, hit in m.groupdict().items():
            if hit is not None and name.startswith("r"):
                src, repl, key = table[int(name[1:])]
                # Backreferences are relative to the rule's own pattern, so run
                # it alone against the matched text rather than against the
                # alternation, where group numbers have shifted.
                out = re.sub(src, repl, m.group(0), flags=re.IGNORECASE) if "\\" in repl else repl
                if out != m.group(0):
                    fixes.append({"start": m.start(), "end": m.end(), "to": out, "rule": key})
                return out
        return m.group(0)

    return pattern.sub(swap, text), fixes


def _load() -> tuple[re.Pattern | None, list]:
    """Recompile only when the file changed.

    The skill and the report page edit corrections.json while this process is
    running. Without the mtime check a new rule would do nothing until the
    server was restarted.
    """
    global _cache
    try:
        mtime = RULES_FILE.stat().st_mtime
    except OSError:
        return None, []
    if mtime != _cache[2]:
        try:
            rules = load_rules()
        except (OSError, json.JSONDecodeError) as exc:
            print(f"  corrections.json ignored: {exc}", flush=True)
            return None, []
        pattern, table = _compile(rules)
        _cache = (pattern, table, mtime)
        print(f"  corrections: {len(table)} rules on", flush=True)
    return _cache[0], _cache[1]


def apply_traced(text: str) -> tuple[str, list[dict]]:
    return _sub(*_load(), text)


def apply(text: str) -> str:
    return apply_traced(text)[0]


def load_rules() -> list[dict]:
    try:
        return json.loads(RULES_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []


def save_rules(rules: list[dict]) -> None:
    """Write one rule per line, through a temporary file so a reader never sees half."""
    body = "[\n" + ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in rules) + "\n]\n"
    RULES_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = RULES_FILE.with_suffix(".json.tmp")
    tmp.write_text(body, encoding="utf-8")
    # Windows refuses the replace while another thread has the file open to read.
    for attempt in range(20):
        try:
            os.replace(tmp, RULES_FILE)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.05)


def check(rule: dict) -> str | None:
    """Why this rule is unusable, or None. Runs the rule alone on its own test."""
    try:
        pattern, table = _compile([{**rule, "on": True}])
    except re.error as exc:
        return f"The pattern is not valid: {exc}."
    case = rule.get("test")
    if not case:
        return "The rule has no test."
    given, want = case
    got, _ = _sub(pattern, table, given)
    if got != want:
        return f"The rule's own test fails: “{given}” became “{got}”, not “{want}”."
    return None


def update(key: str, change) -> dict:
    """Change the rule whose `from` is `key` under the write lock; return it.

    `change` edits the rule in place and may raise ValueError to refuse.
    """
    with _write_lock:
        rules = load_rules()
        for i, rule in enumerate(rules):
            if rule["from"] == key:
                new = dict(rule)
                change(new)
                if new.get("from") != key and any(r["from"] == new.get("from") for r in rules):
                    raise ValueError("Another rule already has that pattern.")
                problem = check(new)
                if problem:
                    raise ValueError(problem)
                rules[i] = new
                save_rules(rules)
                return new
    raise KeyError(key)


def delete(key: str) -> dict:
    with _write_lock:
        rules = load_rules()
        for i, rule in enumerate(rules):
            if rule["from"] == key:
                del rules[i]
                save_rules(rules)
                return rule
    raise KeyError(key)


def add(rule: dict, index: int | None = None) -> None:
    with _write_lock:
        rules = load_rules()
        if any(r["from"] == rule["from"] for r in rules):
            raise ValueError("Another rule already has that pattern.")
        problem = check(rule)
        if problem:
            raise ValueError(problem)
        rules.insert(len(rules) if index is None else index, rule)
        save_rules(rules)


def last_used(rule: dict, entries: list[dict]) -> date:
    """The day the rule last fixed a word in the log, or the day it was added."""
    days = [e["day"] for e in entries for f in e["fixes"] if f["rule"] == rule["from"]]
    added = date.fromisoformat(rule.get("added", date.today().isoformat()))
    return max([added, *days])


def remove_unused(entries: list[dict], today: date | None = None) -> list[dict]:
    """Drop rules that fixed nothing for UNUSED_DAYS. They go to removed.jsonl, not away."""
    today = today or date.today()
    with _write_lock:
        rules = load_rules()
        keep, gone = [], []
        for rule in rules:
            (gone if today - last_used(rule, entries) > timedelta(days=UNUSED_DAYS) else keep).append(rule)
        if gone:
            save_rules(keep)
            with REMOVED_FILE.open("a", encoding="utf-8") as f:
                for rule in gone:
                    f.write(json.dumps({"removed": datetime.now().isoformat(timespec="seconds"), **rule}, ensure_ascii=False) + "\n")
            print(f"  corrections: removed {len(gone)} unused for {UNUSED_DAYS} days", flush=True)
        return gone
