# X For You ranking: what a writer can act on

Built from `xai-org/x-algorithm` at `3b6919f` (2026-11-07) and updated to `30647a8`
(2026-11-14). Paths are relative to that repo; open them at
`https://github.com/xai-org/x-algorithm/blob/main/<path>`. Everything here was checked in
the code by Claude and cross-checked by Grok 4.7, except the last section, which is what
people said on X. The `30647a8` update (copy link to 0, the multi-image view, line
numbers) was checked by Claude only.

## How a post is scored

The ranking model predicts, per viewer, how likely each action is. The score is the sum of
`weight × predicted probability` (or `× predicted seconds` for time). Weights scale
predictions, not raw counts: a report does not "cancel 234 likes"
(`xai-value-model/scoring.rs:28-56`). The lever is making the action *likely for the
people who see it*, which comes from the post and from who it reaches. Only actions on
posts served in Home count; sending people to the post directly does nothing
(`home-mixer/params/param.rs:434-446`).

Weights, `home-mixer/params/param.rs` (production defaults, synced daily):

| Action | Weight | Line | Writer's takeaway |
| --- | --- | --- | --- |
| Reply | 5 | 453 | Something people can answer from experience; bait does not help (below) |
| Reply, on an original post by someone the viewer mutually follows | 5 + 15 | 454-459 | Mutuals' originals get their reply prediction weighted 20. Replies and reposts do not get it (`xai-value-model/inputs.rs:20-22`) |
| Quote | 5 | 502 | A take others want to add to |
| Share via DM | 5 | 490 | "send this to the person who…" value, without asking for it |
| Follow author | 4 | 516 | The post shows a body of work worth following |
| Share (generic) | 2.118 | 488 | Up from 2 on Nov 5 |
| Repost | 1 | 466 | |
| Like | 0.708 | 448 | Up from 0.66 on Nov 5, 0.5 in early Oct |
| Tap into post (click) | 0.274 | 479 | Down from 0.3; a tap alone is worth little |
| Predicted seconds after a tap | 0.385 | 546 | Down from 0.4. A weight on time, not a 10-second gate |
| Open link | 0.2 | 480 | Links are not penalised |
| Dwell (yes/no) | 0.05 | 501 | |
| Predicted seconds on post | 0.0075 | 540 | Up from 0.006; long, readable posts earn this |
| Photo expand | 0.05 | 468 | |
| Copy link | 0 | 496 | Was 20 until Nov 14 (`30647a8`); copying a post's link no longer ranks |
| Video open | 0 | 474 | Was 0.02; the open itself earns nothing |
| Profile click, video quality view, Grok analyze | 0 | 482-538 | |
| Bookmark | none | | Stored as an engagement event, but has no ranking weight |
| Not dwelled (scrolled past) | -0.02 | 572 | |
| Block author | -31.2 | 559 | |
| Not interested | -53.07 | 553 | Was -52.272. Off-topic posts for your audience earn this |
| Mute author | -58.8 | 565 | |
| Report | -234 | 570 | |

Video continuation seconds and profile visit seconds exist as heads with weight 0
(`home-mixer/scorers/value_model.rs:39-41`, `vm-ranker/params.rs`). The weight list at the
top of `vm-ranker/params.rs` (like 0.5, not-interested -47.52) is an unsynced code default;
do not quote it.

README updates (Oct 8, Oct 13) and Elon Musk (Oct 20): the model predicts time spent better,
and retrieval is trained to surface posts people **read all the way through**.

## After scoring

- **Several posts from one author in one feed load**: home-mixer asks `vm-ranker` to
  re-score (`home-mixer/scorers/vm_ranker_request.rs:62`), and its defaults turn on author
  diversity with decay 0.5 and floor 0.25 (`vm-ranker/params.rs:176-192`). Formula
  `(1 - 0.25) × 0.5^k + 0.25` (`xai-value-model/scoring.rs:261`): the second post is
  multiplied by 0.625, the third by 0.4375. The README describes this step too. The
  production value of that switch is not synced into the repo, so treat it as likely, not
  certain. Advice is the same either way: one strong post beats several in a row.
- **Out-of-network** posts are multiplied by 0.75, and so are replies and reposts from
  accounts the viewer does follow (`vm-ranker/params.rs:218`, `xai-value-model/scoring.rs:281-291`).
- **New-author boost**: one original post per feed load (not a reply or repost), author at
  most 50,000 followers, post at most 2 hours old, under 200 Home views, already in the
  top 97% of scores, can be lifted to feed slot 16
  (`home-mixer/scorers/author_cold_start.rs:188-225`, `param.rs:663-699`). Selection uses
  Thompson sampling with a Beta(0.75, 49.25) prior (about 1.5% engagement rate,
  `param.rs:707-730`), so how the first viewers react decides whether it keeps the lift.
  Post when your audience is online.
- **Like milestones**: the 1st like puts a post into a like-based candidate index, and 32
  likes into a second one (`phoenix-rankall-strato/columns/phoenix_rank_all/phoenixRankAllCandidateProcessor.strato:62-89`).
  Like processing re-runs at each power of two (1, 2, 4, 8…) for up to 48 hours. Self-replies
  are skipped (`:481-505`), so later posts in your own thread do not enter these indexes.

## What gets filtered (`home-mixer/filters/`)

- Older than 48 hours: gone from For You (`home-mixer/params/config.rs:39`).
- Replies and reposts from accounts the viewer does not follow are dropped
  (`oon_retweet_reply_filter.rs`). Strangers see your originals and quotes, never your
  replies. A flag to let some replies through exists but is off (`param.rs:68`).
- Only one branch of a conversation is shown (`dedup_conversation_filter.rs`).
- Replies aimed at someone the viewer does not follow are dropped (`self_reply_chain_filter.rs`).
- Video: the long-video candidate indexes need clips over 10 seconds
  (`phoenix-rankall-strato/.../eventProcessing.strato:125-137`).
- The viewer's muted keywords apply. Hashtags add nothing to ranking.

## Labels that limit reach

**Account labels (worst case: every post gone from For You)**, enforced in
`visibility-filtering/rules/levels.rs` for `TIMELINE_HOME_RECOMMENDATIONS`:
- `llm_slop_user`, from a model that reads the account's posts, applies `SpamHighRecall`
  for 7 days (`abuse-enforcement-service/service-lib/rules/enforcement_user.yaml:112-123`).
  That drops the account's posts from For You for everyone but the author
  (`visibility-filtering/rules/author_rules.rs:204-208`). **This is the AI-writing risk that
  matters most**: generic machine-sounding posts risk the whole account for a week.
- 3 adult-labelled posts among the last 5 (within 60 days) label the account for 7 days
  (`safety-label-user-agg/postToUserLabelRules.strato:396-424`). Not limited to media.
- Abusive, do-not-amplify, impersonation and compromised labels also drop the account's posts.

**Post labels on For You**: insults (`FOSNR_ABUSE_INSULTS`, `tweet_rules.rs:169`) drop the
post for everyone but the author; a malicious URL drops it for non-followers
(`tweet_rules.rs:937`).

**Replies under big accounts** (`grox/flows/reply_spam/`):
- A reply is scored 0-3 by Grok 4 mini when the post it answers, or the thread root, belongs
  to an account with more than 250,000 followers (`task_filter.py:185-226`,
  `classifier_reply_ranking.py:30-42`). Replies to yourself or to the root's author are skipped.
- The model sees your profile (name, bio, URLs, recent posts) and these signals
  (`grox/core/lm/thread.py:36-66`): **Reply Was Pasted**, Has Missing Client Events
  (third-party or scripted clients), replies in the last 24h, legit blocks in the last 24h,
  follower count, country, account language, existing risky label. The prompt is not
  published, so how much "pasted" counts is unknown. Pasting matters **only here**: it is
  not in feed ranking.
- Score 0 applies `RiskyHighVizReply` (`task_write.py:140`). Two more routes apply the same
  label: an `llm_slop_post` verdict (30 days, `enforcement_post.yaml:38-43`) and a spam score
  of 0.97 or more (14 days, `botmaker-rules/scarecrow/bot/GroxTweetProcessor.bot`).
- The label keeps the reply out of the target's reply and mention notifications unless they
  follow you (`tweet_rules.rs:1029-1034`, in `NOTIFICATIONS_WRITER_V2_*`, `levels.rs:241-263`).
  So the person you replied to never sees it. Scores only move down.
- Exempt: credibility 66+, or grey badge (`constants.py:9`, `task_write.py:39-71`).
- A second check runs on chains where you reply to your own reply under a root with 1,000+
  followers (`task_multi_step_reply_spam.py:26,85-105`).

**Original posts** are annotated by a Gemma model (`grox/flows/upa/`, originals only):
topics, `isHighQuality`, `isSpam` and a `slop_score`
(`classifier_banger_initial_screen_gemma.py:44-52`). What uses `slop_score` is not published.

**Multi-image posts**: the Grox models are shown all of a
post's images side by side as one view, in the order X shows them, because people slice
one picture across several images (`grox/core/lm/post.py:139-144`). A sliced image is read
as the whole picture.

**Duplicate text**: near-identical posts or replies get `COPYPASTA_SPAM`
(`botmaker-rules/scarecrow/bot/BBQDuplicateText*.bot`). No For You drop is keyed on it in
the repo; `DUPLICATE_CONTENT` drops posts from notifications. Still do not reuse wording.

**Engagement bait**: no For You label for it in the repo. The `EngagementSpammer` account
label drops your notifications for non-followers (`author_rules.rs:260-264`). Bait still
loses on its own terms: it draws "not interested" (-53) and mutes (-58.8).

**Checking your own labels**: Under the Hood, `https://x.com/i/jf/under_the_hood`. Needs an
account at least 1 year old with 10+ posts in the month
(`under-the-hood/strato/columns/underTheHoodReport.User.strato:18-20`). It covers the
previous full month and appears 10 days after month end. It shows account labels (incl.
`SpamHighRecall`, by days) and post labels (since 30 Oct, with post IDs when under 5% of
posts carry one). It does not list `RiskyHighVizReply`
(`under-the-hood/strato/lib/underTheHoodLabels.strato`).

Not found in the code, despite circulating claims: a pinned-link penalty, a profile-dwell
weight above 0, a "+20 for mutual back-and-forth" on replies, a Premium ranking boost.

## Practical rules

1. Write for the like and the read-through: a first line that stops the scroll, then a
   reason to keep reading. Time spent and read-to-the-end are what X is moving weight to.
2. Earn the DM share (5) and the share (2.118): concrete numbers, commands, a tool, a
   result. Copy link no longer counts (0 since Nov 14).
3. One strong original over several in a row.
4. Publish when your audience is online; the first 2 hours and 200 views decide the lift.
5. Strangers see originals and quotes, never replies. Turn a strong reply into a quote.
6. A thread's first post must stand alone; later posts get no reach of their own.
7. Under accounts over 250K: type the reply in the official app, specific to the post, in
   your voice, one per thread.
8. Sound like yourself. Generic AI-sounding posts risk a 7-day account-wide drop.
9. Stay on the topics your audience follows you for; "not interested" is -53.
10. Video: hook early, over 10 seconds. Bookmarks and video opens do not rank.

## What people said on X (not from the code)

- Elon Musk, 20 Oct 2026, new model predicts time spent; retrieval favours read-through:
  https://x.com/elonmusk/status/2112373713937084809
- Nikita Bier, 13 Oct 2026, social surfaces decay into slop unless defended:
  https://x.com/nikitabier/status/2110049188142813692
- Elon Musk, 29 Oct 2026, links are used to improve recommendations:
  https://x.com/elonmusk/status/2115942496098545823
