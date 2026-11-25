# Reviewing an opencode update

Read what changed from the release notes the update links to and from
`opencode run --help`. Then review the release against mngr's opencode support,
`clis/opencode/`, which should stay minimal: every flag and caveat in
`clis/opencode/scripts/lib/opencode.mjs`, `clis/opencode/delegate.md`,
`clis/opencode/contract.md` and `clis/opencode/README.md` should still hold on the new
version. Correct what the release made wrong yourself, describe only the version
`engines.opencode` in mngr's `package.json` now requires, close papercut clusters the
release fixed with `/mngr:papercut opencode --resolve <key> --note "<what changed>"`, and
run `npm run test:opencode` from the repo root after any change. Bring the user features
opencode now does itself, open clusters of three or more, and anything with a trade-off,
each with a recommendation.
