# align

A Claude Code skill. Before it edits anything, it reads the files your request points at, restates the request in your repo's own names, labels what it filled in for you, and stops.

## The failure it prevents

Vague asks — "move the button", "that panel", "make this more compact" — get resolved by convention instead of by the code. The agent picks the sidebar most apps would have, not the one you meant, and you find out after the edit. Google's study of LLM code-editing prompts calls this **faulty localization**: wrong file, wrong widget, wrong scope.

`align` forces the resolution to happen out loud, where a wrong mapping costs one line of correction instead of a reverted commit.

## Install

Clone into your skills directory:

```bash
git clone https://github.com/ahmadghoniem/align ~/.claude/skills/align
```

Or drop `SKILL.md` at `~/.claude/skills/align/SKILL.md` (user-wide) or `.claude/skills/align/SKILL.md` (one project).

## Use

Type `/align` at the end of a messy request:

```
the arrows up and down should be drag-to-reorder instead
this section is too compact
the left thing that used to be on the root — i want it back on /admin
/align
```

The skill is invocation-only (`disable-model-invocation: true`) — it never fires on its own. Nothing is edited until you confirm; after you do, the restatement plus your corrections is the spec, not your original wording.

## Not the same as

- **ask-if-underspecified** style skills — those ask questions. This one commits to a reading first, so you correct a concrete mapping instead of answering an interview.
- **brainstorming / spec-first workflows** — those produce a design document. This is a thirty-second read-back for an ask you've already decided on.
- **Plan mode** — a plan is a *how*. This is "here is what I think you asked, in your repo's nouns."

## Prior art

Closest relatives: gebeer's Cursor prompt-rephrasing rule (keyword trigger, hard stop), Tibo Sottiaux's `ask-questions-if-underspecified` (discovery read before questions), obra/superpowers `brainstorming` (explore context, then gate). The assumption-surfacing block descends from the Karpathy-lineage "assumptions I'm making" prompts.

Background reading: *Rephrase and Respond* ([arXiv:2311.04205](https://arxiv.org/abs/2311.04205)) is this without the human gate; *Understanding and supporting how developers prompt for LLM-powered code editing* ([arXiv:2504.20196](https://arxiv.org/abs/2504.20196)) fills the missing context silently, which is the behavior this skill exists to interrupt. The human-factors name for the ritual is [teach-back](https://www.ahrq.gov/patient-safety/reports/engage/interventions/teachback-mod.html); the model for why it works is Argyris's [Ladder of Inference](https://untools.co/ladder-of-inference/).

## License

MIT
