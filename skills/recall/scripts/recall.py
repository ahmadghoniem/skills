#!/usr/bin/env python3
"""recall: read past Claude Code sessions straight from their transcripts.

Parses ~/.claude/projects/**/*.jsonl so you don't have to. Stores nothing, leaves out the
current session (unless --self), and ends every hit with a receipt (session id:line) that
`show` opens.

  recall.py recent [-n 3] [--all]
  recall.py grep TERM... [--role you,claude,call,out,summary,cmd] [--project P[,P]] [--since D] [--until D]
                 [-n 15] [--per 4] [--self] [--subagents all|ID] [--echoes]
  recall.py calls TERM... [--tool NAME] [--errors] [--project P[,P]] [--since D] [--until D] [-n 100]
                 [--self] [--subagents all|ID] [--echoes]
  recall.py show ID [--prompts | --around LINE [-C 3] | --tail N | --line N] [--tools] [--max N] [--budget N]

TERM is case-insensitive text; quote a phrase to keep it together; `re:PATTERN` is a regex.
"""
import argparse
import errno
import glob
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOME = os.path.expanduser("~")
ROOT = os.path.join(HOME, ".claude", "projects")
CURRENT = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
ROLES = ("you", "claude", "call", "out", "summary", "cmd")
ROLE_TAG = {"you": "you", "claude": "claude", "call": "call", "out": "output", "summary": "compact-summary", "cmd": "cmd"}
ROLE_ALIAS = {"output": "out", "compact-summary": "summary"}
EPOCH = datetime.min.replace(tzinfo=timezone.utc)
SWEEP = 20  # sessions; past this, grep suggests splitting the search across subagents

REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
TAGS = re.compile(r"</?(command-name|command-message|command-args|local-command-stdout|local-command-caveat)>")
CMD_TAGS = re.compile(r"</?local-command-(?:stdout|stderr)>")
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
META = set(".^$|?*+()[]{}\\")
TOOL_ID = re.compile(r'"(?:tool_use_)?id":"(toolu_[^"]+)"')
# recall's own printed results (grep hits, calls rows, show and recent headers): copies of other sessions' lines
ECHO = re.compile(
    r"^\s+[0-9a-f]{8}(?:/agent-[0-9a-z]+)?:\d+ (?:you|claude|call|output|compact-summary|cmd) \d"
    r"|^\d{4}-\d\d-\d\d \d\d:\d\d  [0-9a-f]{8}\S*:\d+  "
    r"|^[0-9a-f]{8}(?:/agent-[0-9a-z]+)?  (?:\d{4}-)?\d\d-\d\d \d\d:\d\d → ", re.M)
# record types that never hold conversation; their lines are skipped before parsing
CONVERSATION_TYPES = ("user", "assistant", "system", "attachment", "ai-title", "summary")


# ---------- helpers ----------

def slug(path):
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def local(dt, fmt="%Y-%m-%d %H:%M"):
    return dt.astimezone().strftime(fmt) if dt else "?"


def day_bound(s, end=False):
    if not s:
        return None
    d = datetime.fromisoformat(s)
    if d.tzinfo is None:
        d = d.astimezone()
    if end and len(s) <= 10:
        d = d.replace(hour=23, minute=59, second=59)
    return d


def one_line(t, n):
    t = re.sub(r"\s+", " ", t).strip()
    return t if len(t) <= n else t[: n - 1] + "…"


def cut(text, limit):
    if limit and len(text) > limit:
        return f"{text[:limit]}\n[cut at {limit} of {len(text)} chars; raise --max]"
    return text


class Terms(list):
    """Compiled patterns for the decoded text, plus `raw`: the same terms as ripgrep patterns for
    the JSON as stored, where a backslash is doubled, a quote is escaped and a line break is `\\n`."""


def term_regex(terms):
    regs, raw = Terms(), []
    for t in terms:
        if t.startswith("re:"):
            regs.append(re.compile(t[3:], re.I))
            raw.append(t[3:])
            continue
        py, rg = [], []
        for part in re.split(r"(\s+)", t):
            if not part:
                continue
            if part.isspace():  # a space in a term matches any whitespace, line breaks included
                py.append(r"\s+")
                rg.append(r"(?:\s|\\[nrt])+")
                continue
            for ch in part:
                esc = "\\" + ch if ch in META else ch
                py.append(esc)
                rg.append(r"\\\\" if ch == "\\" else r'\\?"' if ch == '"' else esc)
        regs.append(re.compile("".join(py), re.I))
        raw.append("".join(rg))
    regs.raw = raw
    return regs


def snippet(text, regs, width=200):
    flat = re.sub(r"\s+", " ", text)
    m = next((m for m in (r.search(flat) for r in regs) if m), None)
    if not m:
        return one_line(flat, width)
    a = max(0, m.start() - width // 3)
    b = min(len(flat), a + width)
    return ("…" if a else "") + flat[a:b] + ("…" if b < len(flat) else "")


def project_name(proj_dir):
    home = slug(HOME) + "-"
    return proj_dir[len(home):] if proj_dir.startswith(home) else proj_dir


def noise(line):
    """True for a line that can't hold conversation: bookkeeping records (API request copies,
    file history, modes, costs...) and attachments other than prompts queued while Claude was busy."""
    if line.startswith('{"type":"'):
        return line[9:line.find('"', 9)] not in CONVERSATION_TYPES
    head = line[:400]
    return '"attachment":{"type":"' in head and '"attachment":{"type":"queued_command"' not in head


# ---------- transcript parsing ----------

def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for c in content:
            if isinstance(c, dict):
                if c.get("type") == "text":
                    out.append(c.get("text", ""))
                elif c.get("type") == "tool_result":
                    out.append(text_of(c.get("content")))
            elif isinstance(c, str):
                out.append(c)
        return "\n".join(out)
    return ""


def cmd_text(content):
    return CMD_TAGS.sub("", ANSI.sub("", text_of(content))).strip()


def items(rec):
    """Yield (role, text, extra) for one JSONL record. Roles: you, claude, call, out, summary, cmd."""
    t = rec.get("type")
    if t == "user":
        c = (rec.get("message") or {}).get("content")
        if isinstance(c, list) and any(isinstance(x, dict) and x.get("type") == "tool_result" for x in c):
            for x in c:
                if isinstance(x, dict) and x.get("type") == "tool_result":
                    yield "out", text_of(x.get("content")), {"error": bool(x.get("is_error")), "id": x.get("tool_use_id")}
            return
        text = REMINDER.sub("", text_of(c)).strip()
        if not text or rec.get("isMeta"):
            return
        if rec.get("isCompactSummary") or text.startswith("This session is being continued from a previous conversation"):
            yield "summary", text, {}
            return
        if text.startswith("<local-command-stdout>"):
            text = cmd_text(text)
            if text:
                yield "cmd", text, {}
            return
        if text.startswith(("<local-command", "<task-notification>", "Base directory for this skill", "[Request interrupted")):
            return
        if text.startswith("<command-name>") and "<command-args></command-args>" in text:
            return
        text = re.sub(r"<command-message>.*?</command-message>", "", text, flags=re.S)
        yield "you", TAGS.sub(" ", text).strip(), {}
    elif t == "attachment":
        a = rec.get("attachment") or {}
        if a.get("type") == "queued_command":  # typed while Claude was busy
            text = REMINDER.sub("", text_of(a.get("prompt"))).strip()
            if text and not text.startswith(("<task-notification>", "<local-command")):
                yield "you", TAGS.sub(" ", text).strip(), {"queued": True}
    elif t == "system":
        if rec.get("subtype") == "local_command":  # a slash command's output, e.g. /context
            text = cmd_text(rec.get("content"))
            if text:
                yield "cmd", text, {}
    elif t == "assistant":
        for x in (rec.get("message") or {}).get("content") or []:
            if not isinstance(x, dict):
                continue
            if x.get("type") == "text" and x.get("text", "").strip():
                yield "claude", x["text"], {}
            elif x.get("type") == "tool_use":
                inp = x.get("input") or {}
                if isinstance(inp, dict) and inp.get("command") is not None:
                    body = inp["command"]
                else:
                    body = json.dumps(inp, ensure_ascii=False)
                yield "call", f"{x.get('name')}: {body}", {"tool": x.get("name"), "id": x.get("id")}


def drop_queued_copies(rows, role_at, text_at, extra_at):
    """A queued prompt is usually stored again as a normal prompt; keep only one."""
    plain = {re.sub(r"\s+", " ", r[text_at]).strip() for r in rows if r[role_at] == "you" and not r[extra_at].get("queued")}
    return [r for r in rows if not (r[extra_at].get("queued") and re.sub(r"\s+", " ", r[text_at]).strip() in plain)]


class Session:
    def __init__(self, path):
        self.path = path
        self.id = os.path.basename(path)[:-6]
        rel = os.path.relpath(path, ROOT).split(os.sep)
        self.sub = "subagents" in rel
        self.parent = rel[1] if self.sub else self.id
        self.project = project_name(rel[0])
        self.title = self.cwd = self.branch = ""
        self.start = self.end = None
        self.compactions = []

    def scan_meta(self, rec, ln):
        ts = parse_ts(rec.get("timestamp"))
        if ts:
            self.start = self.start or ts
            self.end = ts
        if rec.get("type") == "ai-title":
            self.title = rec.get("aiTitle") or self.title
        if not self.cwd and rec.get("cwd"):
            self.cwd = rec["cwd"]
        if rec.get("gitBranch"):
            self.branch = rec["gitBranch"]
        if rec.get("type") == "system" and rec.get("subtype") == "compact_boundary":
            self.compactions.append((ln, (rec.get("compactMetadata") or {}).get("preTokens")))


def receipt(s, ln):
    return f"{s.id[:8]}:{ln}" if not s.sub else f"{s.parent[:8]}/{s.id}:{ln}"


def header(s):
    line = f"{s.id[:8] if not s.sub else s.parent[:8] + '/' + s.id}  {local(s.start)} → {local(s.end)}  {s.project}"
    if s.branch and s.branch != "HEAD":
        line += f"  [{s.branch}]"
    return line + (f"\n    title: {s.title}" if s.title else "")


def session_files(project=None, subagents=None, since=None):
    """Transcripts to search. subagents: None (main sessions only), "all", or a session id prefix."""
    files = glob.glob(os.path.join(ROOT, "*", "**", "*.jsonl"), recursive=True)
    if project:
        ps = [p.strip().lower() for p in project.split(",") if p.strip()]
        files = [f for f in files if any(p in os.path.relpath(f, ROOT).split(os.sep)[0].lower() for p in ps)]
    sub = os.sep + "subagents" + os.sep
    if not subagents:
        files = [f for f in files if sub not in f]
    elif subagents != "all":
        files = [f for f in files if sub not in f or os.path.relpath(f, ROOT).split(os.sep)[1].startswith(subagents)]
    if since:  # a file last written before --since can't hold a record from after it
        files = [f for f in files if os.path.getmtime(f) >= since.timestamp()]
    return [f for f in files if not CURRENT or (os.path.basename(f)[:-6] != CURRENT and os.sep + CURRENT + os.sep not in f)]


def self_scope():
    """(path, line of the latest compaction) of the current session."""
    if not CURRENT:
        sys.exit("--self needs CLAUDE_CODE_SESSION_ID, which Claude Code sets in its shell")
    hits = glob.glob(os.path.join(ROOT, "*", CURRENT + ".jsonl"))
    if not hits:
        sys.exit(f"no transcript for the current session {CURRENT}")
    last = 0
    with open(hits[0], encoding="utf-8", errors="replace") as fh:
        for ln, line in enumerate(fh, 1):
            if '"compact_boundary"' in line and not line.startswith('{"type":"'):
                try:
                    if json.loads(line).get("subtype") == "compact_boundary":
                        last = ln
                except ValueError:
                    pass
    if not last:
        sys.exit("this session has no compaction yet, so all of it is still in your context")
    return hits[0], last


def resolve(ident):
    if os.path.isfile(ident):
        return ident
    hits = glob.glob(os.path.join(ROOT, "*", "**", ident.split("/")[-1] + "*.jsonl"), recursive=True)
    hits = [f for f in hits if os.sep + "subagents" + os.sep not in f] or hits
    if not hits:
        sys.exit(f"no session matches {ident!r}")
    if len(hits) > 1:
        sys.exit("ambiguous id, matches:\n" + "\n".join(hits[:10]))
    return hits[0]


def candidates(regs, files):
    """{file: set of matching line numbers}. ripgrep finds the lines; Python parses only those."""
    wanted = {os.path.normcase(os.path.normpath(f)): f for f in files}
    found = {}
    rg = shutil.which("rg")
    if rg and files:
        args = [rg, "-n", "-H", "-i", "--max-columns", "1", "-m", "100000", "--null", "--no-messages", "--no-ignore",
                "--hidden", "-g", "*.jsonl"]
        if not any(os.sep + "subagents" + os.sep in f for f in files):
            args += ["-g", "!subagents"]
        for r in regs.raw:
            args += ["-e", r]
        # scan only what's wanted: the files themselves when few, else their project folders
        if len(files) <= 120:
            paths = files
        else:
            paths = sorted({os.path.join(ROOT, os.path.relpath(f, ROOT).split(os.sep)[0]) for f in files})
            if len(paths) == len(glob.glob(os.path.join(ROOT, "*", ""))):
                paths = [ROOT]
        out = subprocess.run(args + ["--"] + paths, capture_output=True, encoding="utf-8", errors="replace").stdout
        for row in out.splitlines():
            path, _, rest = row.partition("\0")
            f = wanted.get(os.path.normcase(os.path.normpath(path)))
            if f:
                found.setdefault(f, set()).add(int(rest.split(":", 1)[0]))
        return found
    raw = [re.compile(r, re.I) for r in regs.raw]
    for f in files:
        with open(f, encoding="utf-8", errors="replace") as fh:
            lines = {ln for ln, line in enumerate(fh, 1) if any(r.search(line) for r in raw)}
        if lines:
            found[f] = lines
    return found


def scan(path, regs, lines, since=None, until=None, extra_line=None):
    """Parse the given lines of one transcript (plus what the header needs).
    Returns the Session and [(ln, ts, role, text, extra, which_terms)] for items matching a term."""
    s = Session(path)
    hits = []
    last = None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for ln, line in enumerate(fh, 1):
            want = (ln in lines or (extra_line and extra_line(line))) and not noise(line)
            if not (want or ln < 40 or '"ai-title"' in line or "compact_boundary" in line):
                last = line
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            s.scan_meta(rec, ln)
            if not want:
                continue
            ts = parse_ts(rec.get("timestamp"))
            if since and ts and ts < since or until and ts and ts > until:
                continue
            for role, text, extra in items(rec):
                which = {i for i, r in enumerate(regs) if r.search(text)}
                if which or extra_line:
                    hits.append((ln, ts, role, text, extra, which))
    m = last and re.search(r'"timestamp":"([^"]+)"', last)
    ts = m and parse_ts(m.group(1))
    if ts and (not s.end or ts > s.end):
        s.end = ts
    return s, drop_queued_copies(hits, 2, 3, 4)


def search_files(a, since):
    """(files, line limit per file) for grep and calls: --self, or the filtered transcripts."""
    if a.self:
        path, last = self_scope()
        return [path], {path: last}
    return session_files(a.project, a.subagents, since), {}


def date_hint(a, what, count_without_dates):
    """grep/calls found nothing within --since/--until: say whether anything matches outside it."""
    if not (a.since or a.until):
        return
    n, newest = count_without_dates()
    if n:
        print(f"{n} {what} match outside that date range (newest {local(newest, '%Y-%m-%d')}): drop --since/--until")


# ---------- commands ----------

def cmd_recent(a):
    files = session_files()
    if not a.all:
        here = [f for f in files if os.path.basename(os.path.dirname(f)).lower() == slug(os.getcwd()).lower()]
        if here:
            files = here
        else:
            print(f"no sessions for {os.getcwd()}; showing all projects")
    files.sort(key=os.path.getmtime, reverse=True)
    shown = 0
    for f in files:
        if shown == a.n:
            break
        s = Session(f)
        prompts = []
        with open(f, encoding="utf-8", errors="replace") as fh:
            for ln, line in enumerate(fh, 1):
                if noise(line):
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                s.scan_meta(rec, ln)
                prompts += [(ln, text, extra) for role, text, extra in items(rec) if role == "you"]
        prompts = drop_queued_copies([(ln, "you", t, x) for ln, t, x in prompts], 1, 2, 3)
        if not prompts:
            continue  # opened and closed without a prompt
        shown += 1
        subs = len(glob.glob(os.path.join(os.path.dirname(f), s.id, "subagents", "*.jsonl")))
        print(header(s))
        print(f"    {len(prompts)} prompts, {len(s.compactions)} compactions, {os.path.getsize(f) // 1024} KB"
              + (f", {subs} subagents" if subs else ""))
        print(f"    first L{prompts[0][0]}: {one_line(prompts[0][2], 160)}")
        for ln, _, t, _ in prompts[-3:]:
            print(f"    L{ln}: {one_line(t, 220)}")
        print(f"    path: {f}\n")


def grep_sessions(a, regs, roles, since, until):
    files, limit = search_files(a, since)
    found = []
    for f, lines in candidates(regs, files).items():
        if f in limit:
            lines = {ln for ln in lines if ln < limit[f]}
        s, hits = scan(f, regs, lines, since, until)
        hits = [h for h in hits if h[2] in roles and (a.echoes or h[2] != "out" or not ECHO.search(h[3]))]
        if hits and set().union(*(h[5] for h in hits)) == set(range(len(regs))):
            hits.sort(key=lambda h: h[1] or EPOCH)
            found.append((hits[0][1] or s.start or EPOCH, s, hits))
    return found


def cmd_grep(a):
    regs = term_regex(a.terms)
    roles = {ROLE_ALIAS.get(r, r) for r in a.role.split(",")} if a.role else set(ROLES)
    bad = roles - set(ROLES)
    if bad:
        sys.exit(f"unknown role {', '.join(bad)}; use {','.join(ROLES)}")
    since, until = day_bound(a.since), day_bound(a.until, end=True)
    found = grep_sessions(a, regs, roles, since, until)
    if not found:
        print("no session holds all of " + " / ".join(a.terms) + (f" as {a.role}" if a.role else ""))

        def count():
            every = grep_sessions(a, regs, roles, None, None)
            return len(every), max((x[0] for x in every), default=None)
        date_hint(a, "sessions", count)
        return
    found.sort(key=lambda x: x[0])
    shown = found[-a.n:] if a.n else found
    if len(found) >= SWEEP:
        msgs = sum(len(hits) for _, _, hits in found)
        tokens = sum(len(h[3]) for _, _, hits in found for h in hits if h[2] in ("you", "claude")) // 4
        print(f"{len(found)} sessions match, {msgs} messages"
              + (f" (~{tokens // 1000}K tokens in the matching prompts and replies alone)" if tokens >= 1000 else "")
              + ": too much to read here. "
              "For the full history, split the sessions across parallel Haiku subagents "
              "(by --since/--until or --project), each reporting receipts.")
    if len(shown) < len(found):
        older = found[: len(found) - len(shown)]
        print(f"{len(found)} sessions match; the {len(older)} oldest are left out "
              f"({local(older[0][0], '%Y-%m-%d')} to {local(older[-1][0], '%Y-%m-%d')}): raise -n or narrow with --since/--role")
    if len(found) >= SWEEP or len(shown) < len(found):
        print()
    for _, s, hits in shown:
        print(header(s))
        pick = hits
        if a.per and len(hits) > a.per:
            head = (a.per + 1) // 2
            pick = hits[:head] + [None] + hits[len(hits) - (a.per - head):]
        for h in pick:
            if h is None:
                left = hits[head: len(hits) - (a.per - head)]
                counts = {}
                for x in left:
                    counts[x[2]] = counts.get(x[2], 0) + 1
                print(f"    … {len(left)} more ({', '.join(f'{ROLE_TAG[r]} {n}' for r, n in counts.items())}); --per 0 for all")
                continue
            ln, ts, role, text, extra, which = h
            print(f"    {receipt(s, ln)} {ROLE_TAG[role]} {local(ts)}: {snippet(text, regs)}")
        print()


def find_calls(a, regs, since, until):
    files, limit = search_files(a, since)
    rows = []
    for f, lines in candidates(regs, files).items():
        # ids of tool calls whose input or result matched; then read both halves of each
        ids = set()
        with open(f, encoding="utf-8", errors="replace") as fh:
            for ln, line in enumerate(fh, 1):
                if ln in lines and (f not in limit or ln < limit[f]) and not noise(line):
                    ids.update(TOOL_ID.findall(line))
        if not ids:
            continue
        s, recs = scan(f, regs, set(), since, until,
                       extra_line=lambda line: "toolu_" in line and bool(ids.intersection(TOOL_ID.findall(line))))
        calls, results = {}, {}
        for ln, ts, role, text, extra, which in recs:
            if extra.get("id") not in ids or f in limit and ln >= limit[f]:
                continue
            if role == "call":
                calls[extra["id"]] = (ln, ts, extra.get("tool"), text, which)
            elif role == "out":
                results[extra["id"]] = (extra.get("error"), text, which)
        for cid, (ln, ts, tool, text, which) in calls.items():
            err, out, owhich = results.get(cid, (None, "", set()))
            if which | owhich != set(range(len(regs))):
                continue
            if not a.echoes and not which and ECHO.search(out):
                continue  # matched only inside an earlier recall's printed results
            if a.tool and (tool or "").lower() != a.tool.lower() or a.errors and not err:
                continue
            rows.append((ts or EPOCH, s, ln, tool, err, text, out, which))
    return rows


def cmd_calls(a):
    regs = term_regex(a.terms)
    since, until = day_bound(a.since), day_bound(a.until, end=True)
    rows = find_calls(a, regs, since, until)
    if not rows:
        print("no tool call holds all of " + " / ".join(a.terms) + " in its input or result")

        def count():
            every = find_calls(a, regs, None, None)
            return len(every), max((r[0] for r in every), default=None)
        date_hint(a, "calls", count)
        return
    rows.sort(key=lambda r: r[0])
    errs = sum(1 for r in rows if r[4])
    sessions = len({r[1].parent for r in rows})
    shown = rows[-a.n:] if a.n else rows
    print(f"{len(rows)} calls in {sessions} sessions, {errs} with an error result, "
          f"{local(rows[0][0], '%Y-%m-%d')} to {local(rows[-1][0], '%Y-%m-%d')}"
          + (f"; the {len(rows) - len(shown)} oldest are left out (raise -n or use --since)" if len(shown) < len(rows) else ""))
    print("time  receipt  tool  ok|ERR  input  =>  result")
    for ts, s, ln, tool, err, text, out, which in shown:
        inp = text.split(": ", 1)[-1]
        res = (snippet(out, regs, 160) if not which else one_line(out, 160)) if out else "(no result)"
        print(f"{local(ts)}  {receipt(s, ln)}  {tool}  {'ERR' if err else 'ok'}  "
              f"{snippet(inp, regs, 160) if which else one_line(inp, 160)}  =>  {res}")


def render(role, ln, ts, text, extra, full_out=False, limit=None):
    if role == "call":
        return f"L{ln} → {one_line(text, 300)}" if not full_out else f"L{ln} → {cut(text, limit)}"
    if role == "out":
        flag = " ERROR" if extra.get("error") else ""
        if not full_out:
            return f"L{ln} ← output{flag} {len(text)} chars: {one_line(text, 160)}"
        return f"L{ln} ← output{flag}:\n{cut(text, limit)}"
    if role == "summary":
        if not full_out:
            return f"L{ln} [compaction summary, {len(text)} chars; show --line {ln} to read]"
        return f"L{ln} [compaction summary]\n{cut(text, limit)}"
    if role == "cmd":
        if not full_out:
            return f"L{ln} cmd {local(ts)}: {one_line(text, 160)}" + (f" ({len(text)} chars; --line {ln})" if len(text) > 160 else "")
        return f"L{ln} cmd {local(ts)}:\n{cut(text, limit)}"
    return f"L{ln} {ROLE_TAG[role]} {local(ts)}:\n{cut(text, limit)}"


def cmd_show(a):
    path = resolve(a.id)
    s = Session(path)
    rows = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for ln, line in enumerate(fh, 1):
            if noise(line) and ln != a.line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            s.scan_meta(rec, ln)
            ts = parse_ts(rec.get("timestamp"))
            rows += [(ln, ts, role, text, extra) for role, text, extra in items(rec)]
    rows = drop_queued_copies(rows, 2, 3, 4)
    print(header(s))
    if s.compactions:
        print("    compactions at " + ", ".join(f"L{ln}" + (f" ({pre // 1000}k)" if pre else "") for ln, pre in s.compactions))
    print(f"    path: {path}\n")
    if a.line:
        sel = [r for r in rows if r[0] == a.line]
        for ln, ts, role, text, extra in sel:
            print(render(role, ln, ts, text, extra, full_out=True, limit=a.max))
        if not sel:
            print(f"L{a.line} holds no prompt, reply, tool call or output; try --around {a.line}")
        return
    turns = [i for i, r in enumerate(rows) if r[2] == "you"]
    if a.prompts:
        sel = [r for r in rows if r[2] == "you"]
    elif a.around:
        idx = min(range(len(rows)), key=lambda i: abs(rows[i][0] - a.around)) if rows else 0
        before = [i for i in turns if i <= idx]
        after = [i for i in turns if i > idx]
        start = before[-(a.C + 1)] if len(before) > a.C else 0
        end = after[a.C] if len(after) > a.C else len(rows)
        sel = rows[start:end]  # the turn holding LINE, plus C turns before and after
    elif a.tail:
        sel = rows[turns[-a.tail] if len(turns) >= a.tail else 0:]
    else:
        sel = [r for r in rows if r[2] in ("you", "claude", "cmd")]
    used = 0
    run = []  # consecutive tool calls/outputs, folded into one line unless --tools

    def fold():
        names = {}
        for r in run:
            if r[2] == "call":
                names[r[4].get("tool") or "?"] = names.get(r[4].get("tool") or "?", 0) + 1
        errs = sum(1 for r in run if r[2] == "out" and r[4].get("error"))
        line = (f"L{run[0][0]}–L{run[-1][0]} [{sum(names.values())} tool calls: "
                + ", ".join(f"{n}×{c}" for n, c in names.items())
                + (f"; {errs} errors" if errs else "") + "; --tools to expand]")
        run.clear()
        return line

    for i, (ln, ts, role, text, extra) in enumerate(sel):
        if role in ("call", "out") and not a.tools:
            if a.around or a.tail:
                run.append((ln, ts, role, text, extra))
            continue
        out = (fold() + "\n" if run else "") + render(role, ln, ts, text, extra, full_out=a.tools, limit=a.max)
        if used and used + len(out) > a.budget:
            print(f"\n[stopped at L{ln}: {a.budget} char budget used, {len(sel) - i} items left; "
                  f"continue with --around {ln} or raise --budget]")
            return
        used += len(out)
        print(out)
    if run:
        print(fold())
    if not sel:
        print("nothing to show")


def main():
    p = argparse.ArgumentParser(prog="recall", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("recent", help="latest sessions of this project")
    r.add_argument("-n", type=int, default=3)
    r.add_argument("--all", action="store_true", help="all projects")
    r.set_defaults(fn=cmd_recent)

    def filters(x, n):
        x.add_argument("terms", nargs="+")
        x.add_argument("--project", help="substring of the project folder name; a comma list for several")
        x.add_argument("--since", help="YYYY-MM-DD, local time")
        x.add_argument("--until", help="YYYY-MM-DD, local time, inclusive")
        x.add_argument("-n", type=int, default=n, help="newest N shown (0 = all)")
        x.add_argument("--self", action="store_true",
                       help="search this session from its start to its latest compaction (what compaction summarized away)")
        x.add_argument("--subagents", metavar="all|ID", help="also search subagent transcripts: all, or one session's")
        x.add_argument("--echoes", action="store_true", help="include earlier recall output (copies of other sessions' lines)")
        x.add_argument("--all", action="store_true", help=argparse.SUPPRESS)  # all projects is already the default
        x.add_argument("-i", action="store_true", help=argparse.SUPPRESS)  # already case-insensitive

    g = sub.add_parser("grep", help="messages holding the terms, per session, oldest session first")
    filters(g, 15)
    g.add_argument("--role", help="comma list of " + ",".join(ROLES))
    g.add_argument("--per", type=int, default=4, help="matches per session, first and last (0 = all)")
    g.set_defaults(fn=cmd_grep)

    c = sub.add_parser("calls", help="tool calls whose input or result holds the terms, one per line")
    filters(c, 100)
    c.add_argument("--tool", help="only this tool, e.g. Bash")
    c.add_argument("--errors", action="store_true", help="only calls whose result is an error")
    c.set_defaults(fn=cmd_calls)

    s = sub.add_parser("show", help="read one session")
    s.add_argument("id", help="session id prefix or path")
    s.add_argument("--prompts", action="store_true", help="only your prompts")
    s.add_argument("--around", type=int, help="the turn holding this line, with -C turns before and after")
    s.add_argument("-C", type=int, default=3, help="turns before/after for --around")
    s.add_argument("--tail", type=int, help="last N prompts with everything after them")
    s.add_argument("--line", type=int, help="one line in full, e.g. a receipt's")
    s.add_argument("--tools", action="store_true", help="print tool calls and outputs in full")
    s.add_argument("--max", type=int, default=0, help="cut each message, tool output and summary at N chars (0 = never)")
    s.add_argument("--budget", type=int, default=60000, help="stop after N chars of output")
    s.set_defaults(fn=cmd_show)

    a = p.parse_args()
    try:
        a.fn(a)
        sys.stdout.flush()
    except (BrokenPipeError, OSError) as e:  # output piped to head/sed that stopped reading
        if isinstance(e, BrokenPipeError) or e.errno in (errno.EPIPE, errno.EINVAL):
            try:
                os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
            except OSError:
                pass
            sys.exit(0)
        raise


if __name__ == "__main__":
    main()
