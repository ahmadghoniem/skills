#!/usr/bin/env node
// Turns recorded agy runs into replay fixtures for the reporting eval.
//
// Sources: every finished job under ~/.cad/jobs (record + raw NDJSON log), and
// any capture dropped into evals/fixtures/live/<name>.ndjson with an optional
// <name>.stderr.txt beside it.
//
// What a fixture keeps is what the plugin reads: init, tool step states and
// their error messages, and the result event. Write-ups, tool parameters and
// tool output are replaced by placeholders, and the home directory is masked,
// so no project content leaves the machine it was recorded on.
//
// Each fixture carries a `truth` label derived from the raw run alone, never
// from the plugin's renderer, so the eval can grade the renderer against it.
//
//   node evals/build-fixtures.mjs            # rebuild from ~/.cad and fixtures/live
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const OUT = join(here, 'fixtures', 'replay');
const LIVE = join(here, 'fixtures', 'live');
const JOBS = join(process.env.CAD_HOME || join(homedir(), '.cad'), 'jobs');

const home = homedir();
const homeVariants = [home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\')];

const userParts = basename(home).split(/[\s_.-]+/).filter((p) => p.length > 2);
const userRe = userParts.length
  ? new RegExp(userParts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(?:[\\s_.-]|%20)*'), 'gi')
  : null;

function mask(s) {
  let out = String(s);
  for (const h of homeVariants) out = out.split(h).join('~');
  if (userRe) out = out.replace(userRe, 'USER');
  return out;
}

function cap(s, n = 400) {
  const m = mask(s);
  return m.length > n ? `${m.slice(0, n)}…` : m;
}

function parseLog(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // partial line at a kill boundary
    }
  }
  return events;
}

/** Reduce an event to the fields the plugin reads. */
function scrubEvent(ev) {
  if (ev.event === 'init') {
    return {
      event: 'init',
      conversation_id: ev.conversation_id,
      init: {
        model: ev.init?.model,
        cwd: '~/repo',
        permission_mode: ev.init?.permission_mode,
      },
    };
  }
  if (ev.event === 'step_update') {
    const su = ev.step_update ?? {};
    // The renderer reads failed tool steps only. Successful steps are counted
    // in the fixture's `toolSteps` instead of stored.
    const failed = su.state === 'ERROR' || (su.tool_info?.error && typeof su.tool_info.error === 'object');
    if (su.step_type !== 'tool' || !failed) return null;
    const out = {
      conversation_id: su.conversation_id,
      step_index: su.step_index,
      state: su.state,
      step_type: su.step_type,
    };
    if (su.tool_name) out.tool_name = su.tool_name;
    const info = su.tool_info;
    if (info && typeof info === 'object') {
      out.tool_info = { name: info.name };
      if (info.parameters && typeof info.parameters === 'object') {
        out.tool_info.parameters = Object.fromEntries(Object.keys(info.parameters).map((k) => [k, '[redacted]']));
      }
      if (info.error && typeof info.error === 'object') {
        out.tool_info.error = { type: info.error.type, message: cap(info.error.message ?? '') };
      }
    }
    return { event: 'step_update', step_update: out };
  }
  if (ev.event === 'result') {
    const r = ev.result ?? ev;
    const response = typeof r.response === 'string' ? r.response : '';
    return {
      event: 'result',
      result: {
        conversation_id: r.conversation_id,
        status: r.status,
        response: response.trim() ? `[write-up redacted: ${response.length} chars]` : '',
        ...(r.error != null ? { error: cap(r.error, 1200) } : {}),
        duration_seconds: r.duration_seconds,
        num_turns: r.num_turns,
        usage: r.usage,
      },
    };
  }
  return null;
}

/**
 * Label a run from its raw facts. Order matters: the first matching class wins.
 * `incomplete` means agy did not finish the task it was given.
 */
function label({ events, exitCode, killed, stderr }) {
  const result = events.find((e) => e.event === 'result')?.result;
  const error = String(result?.error ?? '');
  const stderrText = stderr.join('\n');
  const worked = events.some((e) => e.event === 'step_update' && ['tool', 'agent_response'].includes(e.step_update?.step_type));
  const conversationId = events.find((e) => e.event === 'init')?.conversation_id ?? result?.conversation_id;
  const toolErrors = events.filter((e) => e.event === 'step_update' && (e.step_update?.state === 'ERROR' || e.step_update?.tool_info?.error)).length;

  let cls;
  if (killed) cls = 'watchdog';
  else if (exitCode === 127) cls = 'spawn-failed';
  else if (!worked && (exitCode !== 0 || result?.status === 'ERROR')) cls = 'never-started';
  else if (/timeout waiting for response/i.test(error) || /print timeout/i.test(stderrText)) cls = 'timeout';
  else if (/quota/i.test(error)) cls = 'quota';
  else if (/stream was interrupted|network issue|retryable error/i.test(error)) cls = 'stream-drop';
  else if (/not a valid artifact path/i.test(error)) cls = 'refused-write';
  else if (result?.status === 'SUCCESS' && exitCode === 0 && toolErrors === 0) cls = 'clean';
  else if (result?.status === 'SUCCESS' && exitCode === 0) cls = 'clean-with-tool-errors';
  else cls = 'other';

  const incomplete = ['watchdog', 'spawn-failed', 'never-started', 'timeout', 'quota', 'stream-drop'].includes(cls);
  return {
    class: cls,
    incomplete,
    resumable: incomplete && cls !== 'never-started' && cls !== 'spawn-failed' && Boolean(conversationId),
    conversationId: conversationId ?? null,
  };
}

function writeFixture(name, fixture) {
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(fixture, null, 1) + '\n', 'utf8');
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const counts = {};
let n = 0;

if (existsSync(JOBS)) {
  for (const dir of readdirSync(JOBS)) {
    const full = join(JOBS, dir);
    let files;
    try {
      files = readdirSync(full);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      const logFile = join(full, `${id}.ndjson`);
      if (!existsSync(logFile)) continue;
      let rec;
      try {
        rec = JSON.parse(readFileSync(join(full, f), 'utf8'));
      } catch {
        continue;
      }
      if (rec.status === 'running' || rec.status === 'cancelled') continue;
      const raw = parseLog(readFileSync(logFile, 'utf8'));
      const stderr = (Array.isArray(rec.stderrTail) ? rec.stderrTail : []).map((l) => cap(l, 300));
      const truth = label({ events: raw, exitCode: rec.exitCode, killed: Boolean(rec.killed), stderr });
      const events = raw.map(scrubEvent).filter(Boolean);
      const name = `rec-${String(n).padStart(3, '0')}-${truth.class}`;
      writeFixture(name, {
        source: 'recorded',
        recordedAt: rec.startedAt ?? null,
        model: rec.model || null,
        exitCode: rec.exitCode,
        killed: Boolean(rec.killed),
        toolSteps: raw.filter((e) => e.event === 'step_update' && e.step_update?.step_type === 'tool').length,
        stderr,
        truth,
        events,
      });
      counts[truth.class] = (counts[truth.class] ?? 0) + 1;
      n++;
    }
  }
}

if (existsSync(LIVE)) {
  for (const f of readdirSync(LIVE)) {
    if (!f.endsWith('.ndjson')) continue;
    const stem = basename(f, '.ndjson');
    const raw = parseLog(readFileSync(join(LIVE, f), 'utf8'));
    const errFile = join(LIVE, `${stem}.stderr.txt`);
    const stderr = existsSync(errFile)
      ? readFileSync(errFile, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => cap(l, 300))
      : [];
    const exitFile = join(LIVE, `${stem}.exit.txt`);
    const exitCode = existsSync(exitFile) ? Number(readFileSync(exitFile, 'utf8').trim()) : 0;
    const truth = label({ events: raw, exitCode, killed: false, stderr });
    writeFixture(`live-${stem}`, {
      source: 'live-capture',
      recordedAt: null,
      model: raw.find((e) => e.event === 'init')?.init?.model ?? null,
      exitCode,
      killed: false,
      stderr,
      truth,
      events: raw.map(scrubEvent).filter(Boolean),
    });
    counts[truth.class] = (counts[truth.class] ?? 0) + 1;
    n++;
  }
}

console.log(`wrote ${n} fixtures to ${OUT}`);
console.log(counts);
