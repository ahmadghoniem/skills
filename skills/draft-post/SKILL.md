---
name: draft-post
description: Reviews a draft for X (post, reply, quote, thread, X Article, or media caption) against X's open-source ranking code and tightens the copy for likes, read-through and shares. Use when the user is drafting or improving something for X/Twitter ("i want to post about this on x", "improve this tweet", "i'm drafting a tweet", "here's my wip tweet", "give me diff versions", "reply to this tweet", "quote tweeting", "make a thread out of this on x", "write an article on x", "concise as i plan to post on x"), or invokes /draft-post.
license: MIT
argument-hint: "[draft, or what the post is about]"
disable-model-invocation: true
---

Help the user write for X by X's published rules. The rules, with file and line receipts,
are in `reference.md` beside this file. Read it before reviewing.

## 1. Check for algorithm changes

Run, from this skill's base directory:

    node scripts/check-algo.mjs

- `UP TO DATE` or `CHECK FAILED`: say nothing about it and carry on.
- `ONLY NOISE`: carry on, then run `node scripts/check-algo.mjs mark` so the next run is quiet.
- Changed lines: before the review, give the user two or three lines on what changed and
  whether it changes any advice (a weight moving, a filter or label added, a threshold
  changing). Say "not worth adding" when it is plumbing (ads, caching, metrics, tests).
  Only when the user says yes, update `reference.md` (numbers, line refs, the commit at the
  top) and run `node scripts/check-algo.mjs mark`. If they say no, still mark it so it is
  not raised again.

## 2. Work out what is being written

From the prompt, and any screenshot or pasted post: the format (original, reply, quote,
thread, Article, media post), who it answers and roughly how many followers they have
(over 250K changes the reply rules), and the user's own draft if there is one. When there
is no draft yet, ask for the angle in one line or offer a first draft for them to edit.

## 3. Review

Lead with a one-line verdict on what will limit this post's reach. Then, most important
first, the fixes, each tied to a rule in `reference.md` in a few words ("a DM share is
weighted 5: add the actual command"). Cover only what applies:

- **First line**: does it make someone stop and read on? Read-through and time spent rank.
- **Story**: is there one, or only a list of facts? A post reads as a small story when it
  has someone it happens to (the user, a builder, a customer), something in the way (a
  bug, a system, hype, a bad default), a turn (the reveal, what changed) and a resolution
  (the lesson or the irony). Check what is missing; the fewer characters that carry all
  four, the sharper the post. An announcement can still open on the story ("in a galaxy
  far far away", not "today we're excited to announce"). Do not force this onto a short
  reply.
- **Series**: when the user's recent posts are in the conversation or transcripts, does
  this one continue what the account is about, so readers come back to see what happened
  this time? Skip this when there is nothing to compare with.
- **Like and share value**: is there a concrete number, step, tool or result someone would
  copy the link for or DM to a colleague?
- **Reply value**: is there something people can answer from experience? Flag engagement
  bait ("like if", "reply with", "RT if").
- **Fit**: is it on the topics this account is followed for? Off-topic risks "not interested".
- **Format**: a reply that deserves strangers should be a quote post instead (strangers
  never see replies); a thread's first post must stand alone, since later posts get no
  reach of their own; several posts in a row compete with each other.
- **Big-account replies**: specific to the post, in the user's voice, one per thread, typed.
- **Media**: video hook in the first seconds and over 10 seconds; image text readable on a phone.
- **Duplication**: wording reused from the user's earlier replies or posts.
- **AI tells**: generic openers, list-of-three rhythm, "game-changer", em-dash chains,
  hashtags. `llm_slop_user` drops every post of the account from For You for 7 days, so
  this matters beyond one post.

## 4. The edited text

Give the edited post in a code block so it is easy to read and retype. Keep the user's
voice: their wording, casing and length unless a fix needs otherwise. When the user asks
for versions ("give me diff versions"), give two or three that differ in angle or opening,
not in synonyms. Mark anything you invented (a number, a claim) so they can check it.
No Oxford comma: write "a, b and c", never "a, b, and c".

## 5. Posting notes

End with the few that apply:

- Type the final text into the composer rather than pasting it, at least for replies
  under accounts over 250K. Retyping is also a last edit pass.
- Post when the audience is online; the first 2 hours and first 200 impressions decide
  the new-author lift (under 50K followers).
- Leave space before the next post.
- Check the pinned post still represents the account.

Do not suggest ways to fake signals (simulated typing, engagement pods, timed reposts,
reply chains to oneself). Stay inside X's rules.
