# apply-patch

Batch file edits for Claude Code, run through Bash. Several SEARCH/REPLACE blocks across
several files in one call. Every block is checked in memory first; if any fails, no file
is written.

It replaces the Python and Node scripts Claude writes for itself to batch edits
(`s.replace(old, new)` inside a `python - <<'PY'` heredoc). In this machine's
transcripts, 6.0% of those scripts failed against 1.0% for the Edit tool, and a failed
script cost about 1,200 tokens against about 240 for a failed Edit.

## Usage

```
node ~/.claude/scripts/apply-patch/apply-patch.mjs <<'PATCH'
*** Update: src/a.ts
<<<<<<< SEARCH
const a = 1;
=======
const a = 2;
>>>>>>> REPLACE
*** Create: src/new.ts
export const x = 1;
*** Delete: src/old.ts
PATCH
```

Patches over about 5 KB go in a file (Bash heredocs fail past about 7 KB on Windows):
`node …/apply-patch.mjs --file patch.txt`. `--dry-run` checks without writing.

| Header | Body |
| --- | --- |
| `*** Update: <path>` | one or more SEARCH/REPLACE blocks, applied in order |
| `*** Create: <path>` | the new file's content; refused if the file exists |
| `*** Append: <path>` | lines added to the end |
| `*** Delete: <path>` | none |

## Rules

- SEARCH must be non-empty and match exactly once. `<<<<<<< SEARCH all` replaces every copy.
- If there's no exact match, it retries line by line ignoring trailing whitespace, then
  indentation, and says which one matched.
- An empty REPLACE of whole lines removes the lines.
- A file whose every newline is CRLF stays CRLF; any other file is left as it is. A BOM is kept.
- Writes go to a temp file and are renamed into place.
- Exit 0 applied, 1 patch failed (nothing written), 2 patch could not be read.

## Not covered

Regex replacements, JSON/YAML edits, line-number edits and edits looping over a glob of
files. Use `sed`, a script or the Edit tool for those.

## Install

`~/.claude/scripts/apply-patch` is a directory junction to this folder, so edits here are
live. Tests: `npm run test:apply-patch` from the repo root.
