#!/usr/bin/env node
// Recall, broken citations, time and turns for a run.mjs output dir.
//
//   node recall.mjs --tasks <file> --results <dir> [--repo <dir>]
//
// Each task needs `ref`: a reference answer (a file path, relative to the tasks
// file or absolute) whose cited files count as the ones to find. Recall is the
// share of those files the report cites too. A citation is broken when no file
// matches it, or its line is past the end of the file. A path suffix that
// matches exactly one tracked file counts as that file, and an absolute path
// into any copy of the repo (an installed plugin, say) counts from the first
// segment that names a top-level entry of the repo.
//   answered  agy's own duration for stock (its result event), wall for custom.
//             Stock agy can sit idle after answering until --print-timeout.
//   exit      seconds until the process exited.
//   turns     model turns in agy's brain transcript.
//   +bare     recall also counting bare file names (`File.tsx:12`) that match
//             exactly one tracked file.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readTranscript } from '../../scripts/lib/brain.mjs';

const { values: o } = parseArgs({
  options: { tasks: { type: 'string' }, results: { type: 'string' }, repo: { type: 'string' } },
});
if (!o.tasks || !o.results) {
  console.error('usage: node recall.mjs --tasks <file> --results <dir> [--repo <dir>]');
  process.exit(2);
}
const { tasks } = JSON.parse(readFileSync(o.tasks, 'utf8'));
const byId = new Map(tasks.map((t) => [t.id, t]));

const EXT = String.raw`(?:json|tsx|ts|jsx|js|mjs|cjs|md|css|html|yaml|yml|toml|sh|ps1|cmd|lock)(?![\w])`;
const CITE = new RegExp(String.raw`((?:[\w@.-]+/)+[\w@.\-\[\]]+\.` + EXT + String.raw`)(?:(?::|#L)(\d+))?`, 'g');
const BARE = new RegExp(String.raw`(?<![\w@.\-/])([\w@\-\[\]]+(?:\.[\w\-]+)*\.` + EXT + ')', 'g');

/** Tracked files of a repo, indexed by every path suffix and by base name. */
const repos = new Map();
function repoIndex(dir) {
  const root = resolve(dir).replace(/\\/g, '/');
  if (repos.has(root)) return repos.get(root);
  const files = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const top = new Set(files.map((p) => p.split('/')[0]));
  const bySuffix = new Map();
  const add = (k, p) => bySuffix.set(k, [...(bySuffix.get(k) ?? []), p]);
  for (const p of files) {
    const parts = p.split('/');
    for (let k = 1; k < parts.length; k++) add(parts.slice(k).join('/'), p);
  }
  const lineCounts = new Map();
  const idx = {
    root,
    resolve(rel) {
      if (existsSync(join(root, rel))) return rel;
      const parts = rel.split('/');
      const k = parts.findIndex((s, i) => i > 0 && top.has(s));
      if (k > 0 && existsSync(join(root, ...parts.slice(k)))) return parts.slice(k).join('/');
      const c = bySuffix.get(rel) ?? [];
      return c.length === 1 ? c[0] : null;
    },
    lines(rel) {
      if (!lineCounts.has(rel)) lineCounts.set(rel, readFileSync(join(root, rel), 'utf8').split('\n').length);
      return lineCounts.get(rel);
    },
  };
  repos.set(root, idx);
  return idx;
}

/** Make paths in a report workspace-relative. */
function normalise(text, root) {
  let t = text ?? '';
  try {
    t = decodeURIComponent(t);
  } catch {
    // a lone % in the report
  }
  t = t.replace(/\\/g, '/').replace(/file:\/\/\/?/gi, '');
  const prefix = root.replace(/[.*+?^${}()|[\]]/g, (c) => `\\${c}`);
  return t.replace(new RegExp(`${prefix}/`, 'gi'), '');
}

function cites(text, idx) {
  const files = new Set();
  let bad = 0;
  let total = 0;
  const t = normalise(text, idx.root);
  for (const m of t.matchAll(CITE)) {
    const rel = m[1].replace(/^\.\//, '');
    if (/^(http|www\.)/.test(rel) || rel.includes('node_modules')) continue;
    total++;
    const full = idx.resolve(rel);
    if (!full) {
      bad++;
      continue;
    }
    files.add(full);
    if (m[2] && Number(m[2]) > idx.lines(full)) bad++;
  }
  const bare = new Set(files);
  for (const m of t.matchAll(BARE)) {
    const full = idx.resolve(m[1]);
    if (full) bare.add(full);
  }
  return { files, bare, bad, total };
}

/** Seconds agy itself reports in its result event, from the saved stream. */
function agyDuration(file) {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    try {
      const ev = JSON.parse(line);
      if (ev.event === 'result' && typeof ev.result?.duration_seconds === 'number') return ev.result.duration_seconds;
    } catch {
      // not JSON
    }
  }
  return undefined;
}

const share = (found, ref) => (ref.size ? [...ref].filter((f) => found.has(f)).length / ref.size : 0);
const tasksDir = dirname(resolve(o.tasks));
const totals = new Map();
for (const name of readdirSync(o.results).sort()) {
  const m = /^(.+)\.(stock|custom)\.json$/.exec(name);
  const task = m && byId.get(m[1]);
  if (!task) continue;
  const arm = m[2];
  const r = JSON.parse(readFileSync(join(o.results, name), 'utf8'));
  const idx = repoIndex(task.repo ?? o.repo);
  const got = cites(r.report, idx);
  const ref = task.ref ? cites(readFileSync(resolve(tasksDir, task.ref), 'utf8'), idx).files : new Set();
  const recall = share(got.files, ref);
  const recallBare = share(got.bare, ref);
  const answered = r.agyDuration ?? agyDuration(join(o.results, `${m[1]}.${arm}.ndjson`)) ?? r.answeredAt ?? r.wall;
  const turns = readTranscript(r.conversationId).filter((s) => s.type === 'PLANNER_RESPONSE').length;
  console.log(
    `${m[1]} ${arm.padEnd(6)} ${r.agyStatus} answered ${answered.toFixed(0)}s exit ${r.wall.toFixed(0)}s turns ${turns}` +
      ` recall ${recall.toFixed(2)} +bare ${recallBare.toFixed(2)} broken ${got.bad}/${got.total}`,
  );
  const a = totals.get(arm) ?? { n: 0, answered: 0, wall: 0, turns: 0, recall: 0, recallBare: 0, bad: 0, total: 0 };
  a.n++;
  a.answered += answered;
  a.wall += r.wall;
  a.turns += turns;
  a.recall += recall;
  a.recallBare += recallBare;
  a.bad += got.bad;
  a.total += got.total;
  totals.set(arm, a);
}
for (const [arm, a] of totals) {
  console.log(
    `${arm.padEnd(6)} n=${a.n} answered ${a.answered.toFixed(0)}s exit ${a.wall.toFixed(0)}s turns ${a.turns}` +
      ` recall ${(a.recall / a.n).toFixed(2)} +bare ${(a.recallBare / a.n).toFixed(2)} broken ${a.bad}/${a.total}`,
  );
}
