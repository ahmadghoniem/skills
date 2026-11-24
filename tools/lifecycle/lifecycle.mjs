#!/usr/bin/env node
// Live lifecycle check for every council member (paid: it runs the real CLIs).
//   start:    a fresh run is told a secret word and ends with its session id;
//   continue: a second run on that id must say the word back;
//   stop:     a run waiting on a two-minute shell command is killed with its
//             process tree after 30 s, as TaskStop does; no new CLI process
//             and no ping.exe it started may outlive it.
// Usage: node tools/lifecycle/lifecycle.mjs [grok,agy,opencode]
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const MEMBERS = {
  grok: { flag: '--session', id: /^session: (\S+)/m, exe: 'grok.exe', extra: ['--effort', 'low'] },
  agy: { flag: '--conversation', id: /^conversation: (\S+)/m, exe: 'agy.exe', extra: ['--model', 'gemini-3.8-flash-low'] },
  opencode: { flag: '--session', id: /^session: (\S+)/m, exe: 'opencode.exe', extra: [] },
};

function delegate(member, args, cwd, killAfterMs) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(root, 'plugins', member, 'scripts', 'delegate.mjs'), '--', ...MEMBERS[member].extra, ...args], { cwd, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const t = killAfterMs ? setTimeout(() => spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }), killAfterMs) : null;
    child.on('close', (code) => (clearTimeout(t), done({ code, out })));
  });
}

function pids(exe) {
  return new Promise((done) => {
    const p = spawn('tasklist', ['/fo', 'csv', '/nh', '/fi', `imagename eq ${exe}`], { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => done(new Set([...out.matchAll(/^"[^"]+","(\d+)"/gm)].map((m) => m[1]))));
  });
}

const wanted = (process.argv[2] ?? Object.keys(MEMBERS).join(',')).split(',');
// Start and continue run in parallel; the stop checks run one member at a time,
// so a process left behind is pinned on the member that left it.
let stopQueue = Promise.resolve();
const serially = (fn) => (stopQueue = stopQueue.then(fn, fn));
const results = await Promise.all(
  wanted.map(async (member) => {
    const m = MEMBERS[member];
    const cwd = mkdtempSync(join(tmpdir(), `lifecycle-${member}-`));
    const secret = `word-${randomBytes(3).toString('hex')}`;
    const t0 = Date.now();
    const first = await delegate(member, [`Remember this secret word: ${secret}. Do not use any tools. Reply with only: OK`], cwd);
    const id = m.id.exec(first.out)?.[1];
    const start = first.code === 0 && Boolean(id);
    const second = id ? await delegate(member, [m.flag, id, 'What was the secret word I gave you? Reply with only the word.'], cwd) : { code: -1, out: '' };
    const recall = second.code === 0 && second.out.includes(secret);
    const { long, left } = await serially(async () => {
      const before = [...(await pids(m.exe)), ...(await pids('PING.EXE'))];
      const run = await delegate(member, ['Run this shell command and wait for it to finish: ping -n 150 127.0.0.1 . Then reply with its last line.'], cwd, 30_000);
      await new Promise((r) => setTimeout(r, 4_000));
      return { long: run, left: [...(await pids(m.exe)), ...(await pids('PING.EXE'))].filter((p) => !before.includes(p)) };
    });
    return {
      member,
      start: start ? `ok (${id})` : `FAILED: ${first.out.trim().split('\n').slice(-3).join(' | ')}`,
      recall: recall ? 'ok' : `FAILED: ${second.out.trim().split('\n').slice(-3).join(' | ')}`,
      stop: long.code === 0 ? 'finished before the kill (try a longer task)' : left.length ? `FAILED: ${m.exe}/PING.EXE still running: ${left.join(', ')}` : 'ok, no process left',
      seconds: Math.round((Date.now() - t0) / 1000),
    };
  }),
);
for (const r of results) process.stdout.write(`${r.member}: start ${r.start}; continue ${r.recall}; stop ${r.stop}; ${r.seconds}s\n`);
process.exitCode = results.every((r) => r.start.startsWith('ok') && r.recall === 'ok' && r.stop.startsWith('ok')) ? 0 : 1;
