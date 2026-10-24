"""Try, add, narrow or turn off a rule. /refine-dictation's only way to change rules.

    python rules.py try    --from 'Hiber ?mark' --to Hypermark --regex
    python rules.py add    --from Hibermark --to Hypermark --test 'open Hibermark' 'open Hypermark'
    python rules.py narrow --rule cloud --from '(?<!the )cloud' --note 'Changed "in the cloud".'
    python rules.py off    --rule cloud --note 'Changed "in the cloud".'

`try` prints every place in the last 90 days of dictation the pattern would change,
before and after, so a rule is checked against real use before it is saved. `add`
and `narrow` refuse a rule whose own test fails. `narrow` and `off` leave a note
the report page shows under "needs a look". The server picks up every change
without a restart.
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date

import corrections
import dictlog


def _rule(args) -> dict:
    rule = {"from": args.src, "to": args.to}
    if args.regex or args.src != re.escape(args.src):
        rule["type"] = "regex"
    return rule


def cmd_try(args) -> int:
    pattern, table = corrections._compile([_rule(args)])
    hits = 0
    for e in dictlog.entries():
        _, fixes = corrections._sub(pattern, table, e["raw"])
        for f in fixes:
            hits += 1
            raw = e["raw"]
            before = raw[max(0, f["start"] - 60):f["start"]]
            after = raw[f["end"]:f["end"] + 60]
            print(f"{e['at'][:10]}  …{before}[{raw[f['start']:f['end']]} → {f['to']}]{after}…")
    print(f"\n{hits} {'change' if hits == 1 else 'changes'} in the last {dictlog.KEEP_DAYS} days.")
    return 0


def cmd_add(args) -> int:
    rule = {**_rule(args), "added": date.today().isoformat(), "test": list(args.test)}
    try:
        corrections.add(rule)
    except ValueError as exc:
        print(f"Not added: {exc}")
        return 1
    print(f"Added {rule['from']} → {rule['to']}.")
    return 0


def _flag(note: str, suggested: str | None = None) -> dict:
    flag = {"note": note, "at": date.today().isoformat()}
    if suggested:
        flag["suggested"] = suggested
    return flag


def cmd_narrow(args) -> int:
    def change(rule: dict) -> None:
        rule["from"] = args.src
        if args.src != re.escape(args.src):
            rule["type"] = "regex"
        else:
            rule.pop("type", None)
        if args.test:
            rule["test"] = list(args.test)
        rule["flag"] = _flag(f"Narrowed from {args.rule}. {args.note}".strip())

    try:
        rule = corrections.update(args.rule, change)
    except KeyError:
        print(f"No rule {args.rule!r}.")
        return 1
    except ValueError as exc:
        print(f"Not narrowed: {exc}")
        return 1
    print(f"Narrowed to {rule['from']} → {rule['to']}.")
    return 0


def cmd_off(args) -> int:
    def change(rule: dict) -> None:
        rule["on"] = False
        rule["flag"] = _flag(f"Turned off. {args.note}".strip(), args.suggest)

    try:
        rule = corrections.update(args.rule, change)
    except KeyError:
        print(f"No rule {args.rule!r}.")
        return 1
    print(f"Turned off {rule['from']} → {rule['to']}.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("try", help="show what a pattern would change in the last 90 days")
    p.add_argument("--from", dest="src", required=True)
    p.add_argument("--to", required=True)
    p.add_argument("--regex", action="store_true")

    p = sub.add_parser("add", help="save a rule")
    p.add_argument("--from", dest="src", required=True)
    p.add_argument("--to", required=True)
    p.add_argument("--regex", action="store_true")
    p.add_argument("--test", nargs=2, required=True, metavar=("GIVEN", "WANT"))

    p = sub.add_parser("narrow", help="replace a rule's pattern with a narrower one")
    p.add_argument("--rule", required=True, help="the rule's current `from`")
    p.add_argument("--from", dest="src", required=True)
    p.add_argument("--test", nargs=2, metavar=("GIVEN", "WANT"))
    p.add_argument("--note", default="")

    p = sub.add_parser("off", help="keep a rule but stop applying it")
    p.add_argument("--rule", required=True)
    p.add_argument("--note", default="")
    p.add_argument("--suggest", help="a narrower pattern to offer on the report page")

    args = ap.parse_args()
    return {"try": cmd_try, "add": cmd_add, "narrow": cmd_narrow, "off": cmd_off}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
