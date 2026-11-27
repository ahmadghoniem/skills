# Reviewing a codex update

Read what changed from the release notes the update links to and from
`codex exec --help`. Then review the release against mngr's codex support,
`clis/codex/`, which should stay minimal: every flag and caveat in
`clis/codex/scripts/lib/codex.mjs`, `clis/codex/delegate.md`, `clis/codex/contract.md`
and `clis/codex/README.md` should still hold on the new version. In particular, check
whether openai/codex#20919 (a prompt passed as an argument waits on an open stdin) is
fixed, and whether `exec` still offers `request_user_input_async`. Correct what the
release made wrong yourself, describe only the version `engines.codex` in mngr's
`package.json` now requires, close papercut clusters the release fixed with
`/mngr:papercut codex --resolve <key> --note "<what changed>"`, and run
`npm run test:codex` from the repo root after any change. Bring the user features codex
now does itself, open clusters of three or more, and anything with a trade-off, each with
a recommendation.
