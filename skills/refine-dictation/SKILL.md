---
name: refine-dictation
description: Answer a dictated prompt after fixing its speech-to-text errors, and save the safe fixes as rules on the local STT server. Invoke with /refine-dictation.
disable-model-invocation: true
argument-hint: "[dictated prompt]"
---

Everything after `/refine-dictation` is the user's prompt, dictated through Vowen into
the local STT server (Parakeet, `http://127.0.0.1:52625`). The server has already
applied the saved rules to it. Fix what is still wrong, save the fixes that are safe
to make every time, then answer.

Rule changes go through `server/rules.py` in this skill's base directory. In the
commands below, `python` means `C:/stt-bench/.venv/Scripts/python.exe` and `rules.py`
means the full path to that file. Never edit `~/.stt/corrections.json` by hand.

A rule's `from` is plain text unless it has regex characters, and it matches whatever
the case. The server adds `\b` at the edges that are letters or digits, so leave it
out. Put patterns in single quotes so the shell leaves backslashes alone.

## 1. Find the dictation in the log

    curl -s -m 3 "http://127.0.0.1:52625/log?last=5"

Newest first. Each entry has `id`, `raw` (what the model wrote), `text` (after the
rules), `fixes` (each rule fix: `raw[start:end]` became `to`, by rule `rule`) and
`reply`. The dictation is the entry whose `text` matches the prompt; a prompt
dictated in parts matches several. If nothing matches or the server does not answer,
work from the prompt alone and skip the steps that need an `id`.

## 2. Find the errors

An error is a word the model wrote wrong: a misheard name, tool or term (`Hibermark`
for Hypermark, `Haiko` for Haiku), or the wrong form (`plug-in the JSON` for
`plugin.json`). Phrasing, grammar and filler words are how the user talks, not
errors. The model already writes numbers, versions and ordinals well; never make a
rule for them. When the context does not settle what was meant, leave the word.

Check the rule fixes in `fixes` too. A fix that turned a right word wrong is a misfire.

## 3. Save it as a rule, or fix it in this reply only

Save a rule only when both hold:

- The swap is right wherever the wrong form appears, without reading the sentence.
- The user would never say the wrong form on purpose. `Hibermark` qualifies. `cloud`
  does not: they also say "test it in the cloud".

Use the narrowest pattern that catches the error. Then check it against the last 90
days of dictation:

    python rules.py try --from 'Hiber ?mark' --to Hypermark

Read every change it lists. If one is wrong, narrow the pattern and try again, or
fix the word in this reply only. When every change is right, save it with a test
pair: the shortest phrase from this dictation around the error, and the same
phrase fixed.

    python rules.py add --from 'Hiber ?mark' --to Hypermark --test 'session through Hibermark' 'session through Hypermark'

`add` refuses a rule whose test fails or whose pattern another rule already has.

Record the fixes that stay in this reply against the dictation, so the report
counts them:

    curl -s -X POST -H "Content-Type: application/json" -d '{"fixes": [{"from": "urban items", "to": "open items"}]}' http://127.0.0.1:52625/log/<id>/reply

## 4. Fix a misfiring rule

Narrow it when a narrower pattern keeps the fixes it got right (check with `try`).
Otherwise turn it off. Both leave a note on the report page, where the user can undo it.

    python rules.py narrow --rule cloud --from '(?<!the )cloud' --note 'It changed "in the cloud".'
    python rules.py off --rule cloud --note 'It changed "in the cloud".'

`--rule` is the rule's current `from`, as `/log` shows it in `fixes[].rule`.

## 5. Show what changed

Before the answer, one `diff` block, only when something was fixed or a rule changed.
Several fixes share one line pair, in the same order on both lines. Leave out empty
groups. The rule fixes the server already made are not listed.

```diff
@@ saved @@
- Hibermark, plug-in the JSON
+ Hypermark, plugin.json
@@ this reply only @@
- urban items, worm
+ open items, warm
@@ narrowed @@
- cloud
+ (?<!the )cloud
@@ turned off @@
- cloud → Claude
```

## 6. Answer

Answer the fixed prompt as if no skill were loaded. Do not mention the dictation again.
