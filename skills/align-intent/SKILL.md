---
name: align-intent
description: "Rephrases a loose request into a read-back: reads the relevant files first, surfaces competing interpretations, then stops before editing. Invoke with /align-intent."
license: MIT
disable-model-invocation: true
---

# Align intent

Work out what I mean from the code, not just from my phrasing.
Read the relevant files and any provided attachments first, then rephrase what I asked as you now understand it.
If I said delegate it, commit it, or hold off editing, rephrase that back too. Don't act on it.
Make the rephrase about as long as my original prompt.
if a phrase could have multiple interpretations that lead to different results, list them and don't silently pick one ("more compact": tighten the spacing, or drop rows?).
Then stop and wait for my confirmation, so we're aligned before you take any action.
