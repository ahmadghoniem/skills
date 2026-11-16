#!/usr/bin/env node
// Checks xai-org/x-algorithm for commits newer than the one reference.md was built from.
//   node check-algo.mjs          read-only: prints "UP TO DATE" or the ranking-relevant diff
//   node check-algo.mjs mark     records the current upstream HEAD as reviewed
// The repo has no releases and every commit has the same message, so the diff is the only
// signal. Daily commits are mostly a param sync timestamp; those are reported as noise.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "xai-org/x-algorithm";
const STATE = join(dirname(fileURLToPath(import.meta.url)), "..", "algo-state.json");
const MAX_PATCH_LINES = 60;

// Paths whose changes can alter advice. Order matters only for display.
const WATCH = [
  "README.md",
  "home-mixer/params/param.rs",
  "home-mixer/params/config.rs",
  "home-mixer/scorers/vm_ranker_request.rs",
  "vm-ranker/params.rs",
  "xai-value-model/",
  "home-mixer/scorers/",
  "home-mixer/filters/",
  "grox/flows/reply_spam/",
  "grox/flows/upa/",
  "grox/core/lm/",
  "visibility-filtering/rules/tweet_rules.rs",
  "visibility-filtering/rules/levels.rs",
  "visibility-filtering/rules/author_rules.rs",
  "phoenix-rankall-strato/",
  "safety-label-user-agg/",
  "abuse-enforcement-service/service-lib/rules/",
  "visibility-filtering/filter_notifications.rs",
  "botmaker-rules/",
  "abuse-enforcement-service/service-lib/src/rules.rs",
];

const headers = { "User-Agent": "draft-post-skill", Accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function gh(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}`);
  return res.json();
}

function isNoise(line) {
  // param.rs header rewritten on every sync
  return line.includes("last sync ");
}

function relevantPatch(patch = "") {
  return patch
    .split("\n")
    .filter((l) => (l.startsWith("+") || l.startsWith("-")) && !isNoise(l));
}

async function main() {
  const state = JSON.parse(readFileSync(STATE, "utf8"));
  const head = await gh("commits/main");
  const sha = head.sha;

  if (process.argv[2] === "mark") {
    state.reviewed_sha = sha;
    state.reviewed_date = head.commit.committer.date;
    state.checked_at = new Date().toISOString();
    writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
    console.log(`MARKED ${sha.slice(0, 7)} (${state.reviewed_date})`);
    return;
  }

  if (sha === state.reviewed_sha) {
    console.log(`UP TO DATE ${sha.slice(0, 7)}`);
    return;
  }

  const cmp = await gh(`compare/${state.reviewed_sha}...${sha}`);
  const files = cmp.files || [];
  const watched = files.filter((f) => WATCH.some((w) => f.filename === w || (w.endsWith("/") && f.filename.startsWith(w))));
  const meaningful = watched
    .map((f) => ({ ...f, lines: relevantPatch(f.patch) }))
    .filter((f) => f.lines.length > 0 || !f.patch);

  console.log(`NEW COMMITS ${cmp.total_commits} since ${state.reviewed_sha.slice(0, 7)} (${state.reviewed_date}) -> ${sha.slice(0, 7)} (${head.commit.committer.date})`);
  console.log(`${files.length} files changed, ${watched.length} watched, ${meaningful.length} with ranking-relevant lines`);
  if (files.length >= 300) console.log("NOTE: GitHub caps compare at 300 files; some changes may be missing. Clone for a full diff.");
  if (meaningful.length === 0) {
    console.log("ONLY NOISE: nothing in the watched paths beyond sync timestamps.");
    return;
  }
  for (const f of meaningful) {
    console.log(`\n=== ${f.filename} (${f.status}, +${f.additions} -${f.deletions})`);
    if (!f.patch) {
      console.log("(no patch from API: binary or too large; open it on GitHub)");
      continue;
    }
    const shown = f.lines.slice(0, MAX_PATCH_LINES);
    console.log(shown.join("\n"));
    if (f.lines.length > shown.length) console.log(`... ${f.lines.length - shown.length} more changed lines: https://github.com/${REPO}/compare/${state.reviewed_sha}...${sha}`);
  }
}

main().catch((e) => {
  console.log(`CHECK FAILED: ${e.message}. Carry on with reference.md as it is.`);
});
