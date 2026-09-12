# align-intent

A Claude Code skill. Before it edits anything, it reads the files your request points at, rephrases what it now understands, surfaces any competing readings, and stops. It commits to a reading rather than interviewing you, so you correct a concrete mapping in one line.

## Why

Vague asks — "move the button", "that panel", "make this more compact" — get resolved by convention instead of by the code. The agent picks the sidebar most apps would have, not the one you meant, and you find out after the edit. Google's study of LLM code-editing prompts calls this **faulty localization**: wrong file, wrong widget, wrong scope.

## Install

Ships in the `kit` plugin:

```
/plugin marketplace add ahmadghoniem/skills
/plugin install kit@ahmadghoniem
```

Or take the one file: drop [`SKILL.md`](./SKILL.md) at `~/.claude/skills/align-intent/SKILL.md` (user-wide) or `.claude/skills/align-intent/SKILL.md` (one project).

## Use

Type `/align-intent` at the end of a messy request:

```
the arrows up and down should be drag-to-reorder instead
this section is too compact
the left thing that used to be on the root — i want it back on /admin
/align-intent
```

It is invocation-only (`disable-model-invocation: true`), so it never fires on its own, and nothing is edited until you confirm.
