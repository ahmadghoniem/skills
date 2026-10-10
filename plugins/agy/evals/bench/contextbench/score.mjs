#!/usr/bin/env node
// ContextBench scoring for bench runs.
//
//   node score.mjs pred   --tasks tasks.json --run <dir> --arm stock|custom
//   node score.mjs report --tasks tasks.json --run <dir> [--run <dir> ...]
//
// `pred` reads <run>/<id>.<arm>.json and writes <run>/preds.<arm>.jsonl in the
// evaluator's generic format, from the <CONTEXT> block at the end of each report.
// A report with no block falls back to every path:line it cites, and is counted.
// Then run, in the ContextBench checkout:
//   python -m contextbench.evaluate --gold <parquet> --pred <run>/preds.<arm>.jsonl \
//     --cache <dir> --out <run>/eval.<arm>.jsonl
// `report` joins <run>/eval.<arm>.jsonl with the bench results and prints one
// table per arm, averaged over tasks and runs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: o, positionals: [mode] } = parseArgs({
  allowPositionals: true,
  options: { tasks: { type: 'string' }, run: { type: 'string', multiple: true }, arm: { type: 'string' } },
});
const { tasks } = JSON.parse(readFileSync(o.tasks, 'utf8'));
const ARMS = ['stock', 'custom'];
const RANGE = /^(.+?):(\d+)(?:\s*-\s*(\d+))?$/;
/** A path:line or path:start-end anywhere in prose. */
const CITE = /([\w@.~/-]+\.[\w]+):(\d+)(?:\s*-\s*L?(\d+))?/g;

/** Repo-relative path from what an agent wrote: absolute paths, file:// links, backticks. */
function relPath(p, repo) {
  let s = decodeURIComponent(p.trim().replace(/^[`*[(]+|[`*\])]+$/g, '').replace(/^file:\/\/\/?/, '')).replace(/\\/g, '/');
  const root = repo.replace(/\\/g, '/').replace(/^\/+/, '');
  s = s.replace(/^\/+/, '');
  if (s.startsWith(`${root}/`)) s = s.slice(root.length + 1);
  return s.replace(/^\.\//, '');
}

/** {path: [{start, end}]} from a report, and whether it had a <CONTEXT> block. */
function parseContext(report, repo) {
  const spans = {};
  const add = (path, a, b) => {
    const start = Number(a);
    const end = Number(b ?? a);
    (spans[relPath(path, repo)] ??= []).push({ start: Math.min(start, end), end: Math.max(start, end) });
  };
  const block = /<CONTEXT>([\s\S]*?)(?:<\/CONTEXT>|$)/i.exec(report ?? '');
  if (block) {
    for (const raw of block[1].split('\n')) {
      const line = raw.replace(/^\s*[-*]\s*/, '').replace(/`/g, '').trim();
      const m = RANGE.exec(line);
      if (m) add(m[1], m[2], m[3]);
      else if (line && !/\s/.test(line)) spans[relPath(line, repo)] ??= [];
    }
  } else {
    for (const m of (report ?? '').matchAll(CITE)) add(m[1], m[2], m[3]);
  }
  return { spans, hasBlock: Boolean(block) };
}

function pred(run, arm) {
  const lines = [];
  let noBlock = 0;
  let missing = 0;
  for (const t of tasks) {
    const f = join(run, `${t.id}.${arm}.json`);
    if (!existsSync(f)) { missing += 1; continue; }
    const r = JSON.parse(readFileSync(f, 'utf8'));
    const { spans, hasBlock } = parseContext(r.report, t.repo);
    if (!hasBlock) noBlock += 1;
    lines.push(JSON.stringify({
      instance_id: t.id, repo_url: t.repo, commit: t.commit,
      traj_data: { pred_steps: [], pred_files: Object.keys(spans), pred_spans: spans },
    }));
  }
  const out = join(run, `preds.${arm}.jsonl`);
  writeFileSync(out, `${lines.join('\n')}\n`);
  console.log(`${out}: ${lines.length} preds, ${noBlock} without a <CONTEXT> block, ${missing} tasks with no result`);
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const f1 = (p, r) => (p + r ? (2 * p * r) / (p + r) : 0);
const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '-');

function report(runs) {
  for (const arm of ARMS) {
    const rows = [];
    let errors = 0;
    let noBlock = 0;
    let timeouts = 0;
    for (const run of runs) {
      const evalFile = join(run, `eval.${arm}.jsonl`);
      const ev = new Map();
      if (existsSync(evalFile)) {
        for (const l of readFileSync(evalFile, 'utf8').split('\n').filter(Boolean)) {
          const e = JSON.parse(l);
          ev.set(e.instance_id, e);
        }
      }
      for (const t of tasks) {
        const f = join(run, `${t.id}.${arm}.json`);
        if (!existsSync(f)) continue;
        const r = JSON.parse(readFileSync(f, 'utf8'));
        if (r.timedOut || r.killed) timeouts += 1;
        if (!parseContext(r.report, t.repo).hasBlock) noBlock += 1;
        const e = ev.get(t.id);
        // An evaluator error (usually no context extracted) scores zero, not missing.
        if (!e || e.error) errors += 1;
        rows.push({ r, e: e && !e.error ? e : undefined });
      }
    }
    if (!rows.length) continue;
    const g = (fn) => rows.map(({ e }) => (e ? fn(e) : 0));
    const level = (k) => {
      const cov = mean(g((e) => e.final?.[k]?.coverage ?? 0));
      const prec = mean(g((e) => e.final?.[k]?.precision ?? 0));
      return `cov ${fmt(cov)}  prec ${fmt(prec)}  F1 ${fmt(f1(prec, cov))}`;
    };
    const walls = rows.map(({ r }) => r.wall);
    const tok = rows.map(({ r }) => r.usage?.input_tokens).filter(Number.isFinite);
    const out = rows.map(({ r }) => r.usage?.output_tokens).filter(Number.isFinite);
    const tools = rows.map(({ r }) => r.toolCalls).filter(Number.isFinite);
    console.log(`\n== ${arm}: ${rows.length} results over ${runs.length} run(s)`);
    console.log(`file    ${level('file')}`);
    console.log(`symbol  ${level('symbol')}`);
    console.log(`span    ${level('span')}`);
    console.log(`editloc recall ${fmt(mean(g((e) => e.editloc?.recall ?? 0)))}  prec ${fmt(mean(g((e) => e.editloc?.precision ?? 0)))}`);
    console.log(`files predicted ${fmt(mean(g((e) => e.final?.file?.pred_size ?? 0)), 1)}`);
    console.log(`wall mean ${fmt(mean(walls), 0)}s median ${fmt(median(walls), 0)}s max ${fmt(Math.max(...walls), 0)}s`);
    console.log(`tool calls mean ${fmt(mean(tools), 1)}  input tokens mean ${fmt(mean(tok), 0)}  output tokens mean ${fmt(mean(out), 0)}`);
    console.log(`no <CONTEXT> block ${noBlock}  evaluator errors ${errors}  timeouts/kills ${timeouts}`);
  }
}

if (mode === 'pred' && o.run?.length === 1 && ARMS.includes(o.arm)) pred(o.run[0], o.arm);
else if (mode === 'report' && o.run?.length) report(o.run);
else {
  console.error('usage: node score.mjs pred --tasks <file> --run <dir> --arm stock|custom\n       node score.mjs report --tasks <file> --run <dir> [--run <dir> ...]');
  process.exit(2);
}
