# 11 — CRLF line endings degrade the skill's frontmatter

Found while wrapping up, not while looking for it: the skill listing rendered as
`tailwind: Tailwind v4 (semantic tokens)` — the **H1**, not the `description:`. The description is
the entire trigger surface, so losing it costs firings.

## Cause

`git clone` on Windows with `core.autocrlf=true` (the default there) converts on checkout, so
`SKILL.md` lands with CRLF. The frontmatter still *looks* correct — no BOM, `description:` present,
one line — but the parse falls back to the H1.

## Control clone

Same repo, same URL, `core.autocrlf=true` forced on both:

| Commit | `.gitattributes` | `file SKILL.md` |
| --- | --- | --- |
| `b03e0d4` | absent | `UTF-8 text, with CRLF line terminators` |
| `425b6e1` | `* text=auto eol=lf` | `UTF-8 text` |

## Behavioural cost

Same query, same harness (`claude -p … --max-turns 1 --model sonnet < /dev/null`), back to back,
only the line endings of the installed `SKILL.md` differing:

| Installed `SKILL.md` | "clean up my tailwind in components/Sidebar.tsx, the class lists are a mess" |
| --- | --- |
| CRLF | **0/1** |
| LF | **1/1**, reproduced twice |

That query is one of only three in `evals/trigger-eval.json` that fire at all (see `09`), so losing
it is a third of the measured positives, not noise. A second query (`02`, "audit these classes")
fired under both — the degradation is partial, which is why it went unnoticed.

## Fix

`.gitattributes` at the repo root:

```
* text=auto eol=lf
```

This forces LF on checkout regardless of the cloner's `core.autocrlf`. Verified by the control
clone above.

## Why this was nearly missed

The working tree only turned CRLF after a `git checkout` — every file written directly by an editor
or script stayed LF. So the skill was authored, evaluated and installed on LF, and would only have
broken for **someone else cloning it on Windows**, or for the author after any branch switch. Every
number in `09` was measured on LF and stands.

**Verdict: CONFIRMED — measured**, both the cause (control clone) and the cost (trigger test).
