# Changelog

## Unreleased

- Muse Wonder joins the standing council as the `muse` seat, on opencode's `meta` provider (`meta/muse-wonder-1.0`). The convene example and the default roster are now Grok, Neon and Muse; the DeepSeek seat is out of the example.
- Seats don't see each other's model names. Each seat gets a random letter (Seat A, B, C …), kept for the whole council, and the others see only that letter and what the seat could use (`access`, defaulting per member: grok "read the repo; had web and X search", agy and opencode "read the repo; had web search"). Per-seat brief and output files are named by letter. The round summary and the chair's report keep the real names.
- Seats no longer get roles or per-seat claims: every seat gets the same question and brief and decides for itself what matters. The `role` field is gone, and the roster's Role column is now Kind (core or auditor).

## 0.1.0

First release: `/council:convene`, `/council:roster`, `round.mjs` and `roster.mjs`, with grok, agy and opencode as members.
