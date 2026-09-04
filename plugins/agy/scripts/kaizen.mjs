#!/usr/bin/env node
// Read the papercut log and print it clustered, newest first.
//
// This script only reads and groups. It proposes nothing and changes nothing —
// the reading is a conversation, in `/agy:kaizen`, with a human in it.
import { collapseCommandArgv, invokedAsScript, parseArgv } from './lib/args.mjs';
import { appendPapercut, pluginVersion, readPapercuts } from './lib/papercuts.mjs';
import { papercutsPath } from './lib/paths.mjs';

const USAGE = `Usage: /agy:kaizen [--all] [--kind <name>] [--since <YYYY-MM-DD>]
                  [--resolve <id> --note "<what was changed>"]

  --all      include cuts already marked resolved
  --kind     show only one cluster (a warning id, or narrated/orchestrator)
  --since    ignore cuts older than this date
  --resolve  append a resolution for one cut (the log is never rewritten)
`;

/**
 * A cut's cluster key: the id of the ⚠ line that produced it, or — for the
 * hand-written rows, which have no machine id — simply where it came from.
 *
 * There is deliberately no tag vocabulary. A fixed list of categories invented
 * before any cuts exist is a guess about what the log will contain, and a wrong
 * guess files real problems under the wrong heading, which is worse than
 * leaving them unfiled. The grouping here is free and always correct; the finer
 * reading is a job for whoever runs `/agy:kaizen`, who has the text in front of
 * them and can see what actually recurs.
 *
 * @param {Record<string, unknown>} cut
 * @returns {string}
 */
function clusterKey(cut) {
  if (typeof cut.warningId === 'string' && cut.warningId) return cut.warningId;
  return typeof cut.source === 'string' ? cut.source : 'unknown';
}

/**
 * @param {Record<string, unknown>[]} cuts
 * @returns {Set<string>}
 */
function resolvedIds(cuts) {
  const ids = new Set();
  for (const c of cuts) {
    if (typeof c.resolves === 'string' && c.resolves) ids.add(c.resolves);
  }
  return ids;
}

/**
 * @param {Record<string, unknown>} cut
 * @returns {string}
 */
function line(cut) {
  const bits = [`  \`${cut.id}\``, String(cut.ts ?? '').slice(0, 10)];
  if (cut.toolVersion) bits.push(String(cut.toolVersion));
  if (typeof cut.toolCalls === 'number') {
    const files = typeof cut.filesChanged === 'number' ? cut.filesChanged : '?';
    bits.push(`${cut.toolCalls} calls / ${files} files`);
  }
  const head = bits.join('  ');
  const body = `      ${String(cut.text ?? '').trim()}`;
  const out = [head, body];
  if (cut.fix) out.push(`      fix: ${String(cut.fix).trim()}`);
  const ev = cut.evidence;
  if (ev && typeof ev === 'object') {
    const keys = Object.keys(ev).filter((k) => k !== 'agyStatus' && k !== 'exitCode');
    for (const k of keys.slice(0, 3)) {
      const v = /** @type {Record<string, unknown>} */ (ev)[k];
      const rendered = Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; ') : String(v);
      out.push(`      ${k}: ${rendered.slice(0, 200)}`);
    }
  }
  return out.join('\n');
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { flags } = parseArgv(collapseCommandArgv(rawArgv), ['all', 'help'], {
    honorDoubleDash: false,
  });
  if (flags.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const all = readPapercuts();

  if (typeof flags.resolve === 'string' && flags.resolve.trim()) {
    const target = flags.resolve.trim();
    if (!all.some((c) => c.id === target)) {
      process.stderr.write(`Error: no papercut \`${target}\` in ${papercutsPath()}.\n`);
      return 2;
    }
    const note = typeof flags.note === 'string' ? flags.note.trim() : '';
    if (!note) {
      process.stderr.write('Error: --resolve needs --note saying what was changed.\n');
      return 2;
    }
    // Appended, never edited in place. A resolution that stops working shows up
    // as the same cluster reappearing *after* its resolution date, and that only
    // survives if the original row and the resolution both stay on the record.
    const id = appendPapercut({
      ts: new Date().toISOString(),
      source: 'orchestrator',
      severity: 'info',
      tool: 'agy',
      pluginVersion,
      text: note,
      resolves: target,
    });
    process.stdout.write(`resolved \`${target}\` (recorded as \`${id}\`).\n`);
    return 0;
  }

  const closed = resolvedIds(all);
  const since = typeof flags.since === 'string' ? flags.since.trim() : '';
  const onlyKind = typeof flags.kind === 'string' ? flags.kind.trim() : '';

  const open = all.filter((c) => {
    if (c.resolves) return false;
    if (!flags.all && closed.has(String(c.id))) return false;
    if (since && String(c.ts ?? '') < since) return false;
    if (onlyKind && clusterKey(c) !== onlyKind) return false;
    return true;
  });

  if (open.length === 0) {
    process.stdout.write(`No open papercuts in ${papercutsPath()}.\n`);
    return 0;
  }

  /** @type {Map<string, Record<string, unknown>[]>} */
  const clusters = new Map();
  for (const c of open) {
    const k = clusterKey(c);
    if (!clusters.has(k)) clusters.set(k, []);
    clusters.get(k).push(c);
  }

  const ordered = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length);
  const out = [`${open.length} open papercut${open.length === 1 ? '' : 's'} in ${ordered.length} cluster${ordered.length === 1 ? '' : 's'}:`, ''];

  for (const [key, cuts] of ordered) {
    cuts.sort((a, b) => (String(a.ts) < String(b.ts) ? 1 : -1));
    const sources = [...new Set(cuts.map((c) => c.source))].join('/');
    const versions = [...new Set(cuts.map((c) => c.toolVersion).filter(Boolean))];
    const span = versions.length ? `, ${versions.join(' ')}` : '';
    out.push(`## ${key} — ${cuts.length}× (${sources}${span})`);
    for (const c of cuts) out.push(line(c));
    out.push('');
  }

  // Recurrence after a resolution is the one signal this log gives for free, and
  // it is the only feedback the loop has: no scorer re-runs these, so a fix that
  // did not work is invisible unless the cluster is read against its own history.
  const reappeared = [];
  for (const [key, cuts] of ordered) {
    const closedInCluster = all.filter(
      (c) => c.resolves && all.some((o) => o.id === c.resolves && clusterKey(o) === key),
    );
    if (!closedInCluster.length) continue;
    const lastFix = closedInCluster.map((c) => String(c.ts)).sort().at(-1);
    const after = cuts.filter((c) => String(c.ts) > lastFix);
    if (after.length) reappeared.push(`  ${key}: ${after.length} new since the ${String(lastFix).slice(0, 10)} fix`);
  }
  if (reappeared.length) {
    out.push('Recurred after a recorded fix — the fix did not hold:');
    out.push(...reappeared);
    out.push('');
  }

  process.stdout.write(out.join('\n'));
  return 0;
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `kaizen failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(1);
    });
}
