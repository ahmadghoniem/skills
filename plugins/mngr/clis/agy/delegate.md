# agy

**What it's for:** well-specified, high-volume work, code sweeps and research passes that
would otherwise consume context better spent on judgement.

**What it reads:** `AGENTS.md` and `GEMINI.md`, which it loads itself, so do not repeat
those. It does not read the repo's `CLAUDE.md`: put what the task needs from it under
Repo context.

**Model:** omit `--model`: mngr uses `gemini-4-hydrogen-medium`. Pass `--model` with a full
id when the user names a model, or for work that needs more reasoning
(`gemini-4-hydrogen-high` or `-xhigh`, which take longer). The id carries the effort level.
When the user is unsure what is available or a model is out of quota, run `agy models`
(about a second) and pick from what it lists; never invent an id.

| Flag | Effect |
| --- | --- |
| `--model <id>` | A full model id. Defaults to `gemini-4-hydrogen-medium`. |
| `--conversation <uuid>` | Continue that conversation, with the id from a run's last line. A follow-up goes in the prompt. |

agy keeps each conversation's record in
`~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl`.
