> **Archive stub.** The full text was removed — it was a third-party skill reproduced verbatim
> inside an MIT repo. Its rules are quoted rule-by-rule, with verdicts, in
> [findings-cursor-copy.md](findings-cursor-copy.md). Sibling reject:
> [candidate-hairyf-index.md](candidate-hairyf-index.md). Index: [README.md](README.md).

# Candidate: the "12 critical rules" skill (rejected)

**Source: no public URL recorded.** It arrived as a local file, `tailwindcss - Copy.md`, and was
evaluated on 2026-08-18. If you need the original, it is whatever that file was — this tree never
captured an upstream link, which is itself a lesson about vendoring someone else's work.

A short always-on skill: twelve numbered "Wrong (agents do this) / Correct / Why" rules, plus a
closing list of NEVERs. Structurally close to ours, which is why it was worth checking rather than
dismissing.

## Verdict

Most rules were already covered or correct-but-missing; the full A/B/C/D classification is in
[findings-cursor-copy.md](findings-cursor-copy.md). It was rejected as a whole for one reason:

## Rule 9, kept verbatim as the negative example

`../CLAIMS.md` cites this line, so it stays here in full:

```
9. Use Renamed Utilities
Wrong (agents do this):
<div class="shadow-sm ring-1 ring-gray-900/5">
  <div class="blur-sm">
    <div class="rounded-sm"></div>
  </div>
</div>
Correct:
<div class="shadow-xs ring-1 ring-gray-900/5">
  <div class="blur-xs">
    <div class="rounded-xs"></div>
  </div>
</div>
Why: In v4, shadow-sm was renamed to shadow-xs, shadow to shadow-sm, blur-sm to blur-xs,
rounded-sm to rounded-xs, etc. The old -sm values now map to what was previously the default.
```

and from its NEVER list:

```
NEVER use shadow-sm when you mean the smallest shadow - it's now shadow-xs
```

**This corrupts v4 code.** The mapping is a v3→v4 *migration* table, and applying it to code already
written in v4 turns a valid `shadow-sm` into `shadow-xs` — a different, smaller shadow. `shadow-sm`
is a real v4 class. The smallest v4 shadow is `shadow-2xs`, which the rule never mentions.

A rule that is true as a migration step and false as a standing instruction is the sharpest failure
mode in this whole class of skill, and it is why `tailwind/SKILL.md` carries an explicit
do-not-over-correct list rather than only a rename table.
