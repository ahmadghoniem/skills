#!/usr/bin/env node
// Runs one council round: every chosen seat gets the brief at once, on the code
// as it stands (stamped with the commit), and the round ends when all have
// answered or the hard timeout passes; a seat still running then is stopped and
// marked MISSING. Prints each seat's final-answer block.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANSWER_RULES, councilDir, finalBlock, readCouncil, writeCouncil } from './lib/council.mjs';
import { changedDuring, snapshot } from './lib/git.mjs';
import { delegatePath, MEMBERS, seatArgs, sessionFrom } from './lib/members.mjs';
import { parseCli, run, runAsScript, spawnDirect } from './lib/shared/proc.mjs';

const USAGE = 'Usage: round.mjs --council <name> --brief <file> [--seats a,b] [--timeout-min 30] [--no-others]\n';

/** Run one seat's delegate.mjs; stop its whole process tree at the deadline. */
function runSeat(delegate, args, timeoutMs) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    const child = spawnDirect(delegate, ['--', ...args], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (out += d));
    const timer = setTimeout(() => {
      timedOut = true;
      run('taskkill', ['/pid', String(child.pid), '/T', '/F'], { timeoutMs: 15_000 }).then((r) => r.exitCode !== 0 && child.kill());
    }, timeoutMs);
    const done = (exitCode) => {
      clearTimeout(timer);
      resolveRun({ out, exitCode, timedOut, ms: Date.now() - started });
    };
    child.on('error', (err) => {
      out += String(err?.message ?? err);
      done(-1);
    });
    child.on('close', (code) => done(typeof code === 'number' ? code : -1));
  });
}

const minutes = (ms) => `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;
const describe = (s) => [s.member, s.model ?? MEMBERS[s.member].defaultModel, s.effort].filter(Boolean).join(', ');

/** @param {string[]} argv */
export async function main(argv) {
  let values;
  try {
    ({ values } = parseCli(argv, {
      council: { type: 'string' },
      brief: { type: 'string' },
      seats: { type: 'string' },
      'timeout-min': { type: 'string', default: '30' },
      'no-others': { type: 'boolean' },
      help: { type: 'boolean' },
    }));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n${USAGE}`);
    return 2;
  }
  if (values.help) return process.stdout.write(USAGE), 0;
  if (!values.council || !values.brief) return process.stderr.write(`Error: --council and --brief are required.\n${USAGE}`), 2;
  const timeoutMs = Number(values['timeout-min']) * 60_000;
  if (!(timeoutMs > 0)) return process.stderr.write('Error: --timeout-min must be a positive number.\n'), 2;
  let council;
  let delta;
  try {
    council = readCouncil(values.council);
    delta = readFileSync(values.brief, 'utf8');
  } catch (err) {
    return process.stderr.write(`Error: ${err.message}\n`), 2;
  }
  const wanted = values.seats ? values.seats.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const unknown = (wanted ?? []).filter((n) => !council.seats.some((s) => s.name === n));
  if (unknown.length) return process.stderr.write(`Error: no seat ${unknown.join(', ')} in ${values.council}.\n`), 2;
  const seats = council.seats.filter((s) => (wanted ? wanted.includes(s.name) : !s.auditor));
  const missingPlugin = seats.filter((s) => !delegatePath(s.member));
  if (missingPlugin.length) {
    return process.stderr.write(`Error: plugin not installed for ${missingPlugin.map((s) => `${s.name} (${s.member})`).join(', ')}.\n`), 2;
  }

  const round = council.rounds + 1;
  const dir = join(councilDir(council.name), `round-${round}`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(values.brief, join(dir, 'brief.md'));
  if (round === 1) council.firstBrief = join(dir, 'brief.md');
  const prev = join(councilDir(council.name), `round-${round - 1}`);

  const before = await snapshot(process.cwd());
  const frozen = before
    ? `The code is frozen at commit ${before.sha}${before.dirty.length ? `, plus ${before.dirty.length} uncommitted file(s) as they are now` : ''}.`
    : 'The workspace is not a git repository.';

  const others = (self) => {
    if (round === 1 || values['no-others']) return '';
    const blocks = council.seats
      .filter((s) => s.name !== self.name && existsSync(join(prev, `${s.name}.out.md`)))
      .map((s) => `### ${s.name} (${describe(s)})\n\n${finalBlock(readFileSync(join(prev, `${s.name}.out.md`), 'utf8')) ?? '(no final answer block: MISSING or failed last round)'}`);
    return blocks.length ? `\n\n## The other members' final answers from round ${round - 1}\n\nRead them as a colleague's: check their evidence, don't adopt their conclusions.\n\n${blocks.join('\n\n')}` : '';
  };

  const results = await Promise.all(
    seats.map(async (seat) => {
      // A seat with no session (new, or MISSING last time) gets the first brief again.
      const context = seat.session || round === 1 || !council.firstBrief ? delta : `${readFileSync(council.firstBrief, 'utf8')}\n\n## Since then (round ${round})\n\n${delta}`;
      const header = `# Council \`${council.name}\`, round ${round}\n\nYou are the seat \`${seat.name}\`. ${frozen}\n\n`;
      const file = join(dir, `${seat.name}.brief.md`);
      writeFileSync(file, `${header}${context}${others(seat)}\n${ANSWER_RULES}`, 'utf8');
      const r = await runSeat(delegatePath(seat.member), seatArgs(seat, file), timeoutMs);
      writeFileSync(join(dir, `${seat.name}.out.md`), r.out, 'utf8');
      const session = sessionFrom(seat.member, r.out);
      if (session) seat.session = session;
      else if (r.timedOut) delete seat.session;
      return { seat, ...r, block: finalBlock(r.out) };
    }),
  );

  const after = await snapshot(process.cwd());
  council.rounds = round;
  writeCouncil(council);

  const status = (r) => (r.timedOut ? 'MISSING (stopped at the timeout)' : r.exitCode !== 0 ? `FAILED (exit ${r.exitCode})` : r.block ? 'answered' : 'answered without a final answer block');
  const lines = [`# Council \`${council.name}\`, round ${round}`, '', frozen, ''];
  for (const r of results) lines.push(`- **${r.seat.name}** (${describe(r.seat)}): ${status(r)} in ${minutes(r.ms)}`);
  const changed = changedDuring(before, after);
  if (changed.length) lines.push('', '⚠ The workspace changed during the round, so the seats may have read different code:', ...changed.map((c) => `    ${c}`));
  for (const r of results) {
    lines.push('', `## ${r.seat.name}`, '');
    if (r.block) lines.push(r.block);
    else lines.push('```', ...r.out.trimEnd().split(/\r?\n/).slice(-15), '```');
  }
  lines.push('', `Full outputs: ${dir}`);
  const text = `${lines.join('\n')}\n`;
  writeFileSync(join(dir, 'summary.md'), text, 'utf8');
  process.stdout.write(text);
  return 0;
}

runAsScript(import.meta.url, main);
