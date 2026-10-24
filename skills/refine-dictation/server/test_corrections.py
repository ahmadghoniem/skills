"""Run every rule's own test case.

    C:\\stt-bench\\.venv\\Scripts\\python.exe test_corrections.py

Each rule in ~/.stt/corrections.json carries a ["given", "want"] pair. This
checks the rule does what it claims, alone and alongside every other rule that is
on. It does not check the rule leaves other sentences alone: /refine-dictation
checks that against the dictation log when it writes the rule.
"""

from __future__ import annotations

import sys

import corrections


def main() -> int:
    rules = corrections.load_rules()
    failures: list[str] = []

    for rule in rules:
        problem = corrections.check(rule)
        if problem:
            failures.append(f"{rule['from']!r}: {problem}")
            continue
        if rule.get("on", True) is False:
            continue
        given, want = rule["test"]
        got = corrections.apply(given)
        if got != want:
            failures.append(f"{given!r}\n    want {want!r}\n    got  {got!r}")

    if failures:
        print(f"FAIL ({len(failures)})\n")
        for f in failures:
            print(f"  {f}\n")
        return 1

    print(f"ok - {len(rules)} rules")
    return 0


if __name__ == "__main__":
    sys.exit(main())
