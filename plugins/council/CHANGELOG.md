# Changelog

## Unreleased

- The chair rules are checked by script, not only asked for. `round.mjs` refuses round 1 until `chair.md` exists, so the chair can't read the seats before writing its own position. The new `check.mjs` fails when an OPEN dispute in `disputes.md` is missing from the chair's `report.md`, or was reworded. Disputes now sit under `### D<n>: … (OPEN)` headings so the check can find them.
- Edits during a round are caught outside git too: the round notes every file's size and modified time before and after (up to 20,000 files). In a git repo it now also catches a second edit to a file that was already uncommitted, which the file list alone missed.
- `council.json` is saved as each seat finishes, not only when the round ends, so stopping a round halfway keeps the sessions of the seats that answered.
- Muse Wonder joins the standing council as the `muse` seat, on opencode's `meta` provider (`meta/muse-wonder-1.0`). The convene example and the default roster are now Grok, Neon and Muse; the DeepSeek seat is out of the example.
- Seats don't see each other's model names. Each seat gets a random letter (Seat A, B, C …), kept for the whole council, and the others see only that letter and what the seat could use (`access`, defaulting per member: grok "read the repo; had web and X search", agy and opencode "read the repo; had web search"). Per-seat brief and output files are named by letter. The round summary and the chair's report keep the real names.
- Seats no longer get roles or per-seat claims: every seat gets the same question and brief and decides for itself what matters. The `role` field is gone, and the roster's Role column is now Kind (core or auditor).

## 0.1.0

First release: `/council:convene`, `/council:roster`, `round.mjs` and `roster.mjs`, with grok, agy and opencode as members.
