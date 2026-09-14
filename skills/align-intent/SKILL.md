---
name: align-intent
description: "Rephrases a loose request into a read-back: reads the relevant files first, surfaces competing interpretations, then stops before editing. Invoke with /align-intent."
license: MIT
disable-model-invocation: true
---

# Align intent

Before you touch anything, work out what I mean from the code rather than from my phrasing alone. Read the files my request points at and any attachments I provided, then rephrase my request as you now understand it, about as long as the original, with every loose reference ("that panel", "the left thing") resolved to the concrete file, component, or element you believe I mean, so a wrong mapping is something I correct in one line rather than discover after the edit.

Where a phrase has multiple interpretations that would lead to different results, list them instead of silently picking one ("more compact": tighten the spacing, or drop rows?). Otherwise commit to the interpretation the code supports. If I also told you to delegate, commit, or hold off on editing, include that in the rephrase rather than doing it.

Then stop and wait for my confirmation, so we're aligned before you take any action.
