// node --test plugins/_shared/shared.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { appendPapercut, formatOpenPapercuts, readPapercuts } from './papercuts.mjs';
import { parseCli } from './proc.mjs';
import { compareVersions, latestRelease, noticeOnce, parseVersion, releasesSince, reviewedVersion, setReviewedVersion } from './release.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'shared-test-'));

test('versions compare numerically', () => {
  assert.equal(compareVersions('1.0.10', '1.0.9'), 1);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(parseVersion('grok 1.0.92 (b06)'), '1.0.92');
  assert.deepEqual(releasesSince({ '1.0.1': '2026-01-01T', '1.0.2': '2026-01-02T', '1.0.3-alpha': 'x' }, '1.0.0', '1.0.2').map((r) => r.version), ['1.0.1', '1.0.2']);
});

test('the reviewed version lives in engines', () => {
  const dir = tmp();
  const pkg = join(dir, 'package.json');
  writeFileSync(pkg, JSON.stringify({ engines: { grok: '>=1.0.70' } }));
  assert.equal(reviewedVersion(pkg, 'grok'), '1.0.70');
  setReviewedVersion(pkg, 'grok', '1.0.92');
  assert.equal(reviewedVersion(pkg, 'grok'), '1.0.92');
  rmSync(dir, { recursive: true });
});

test('the update notice prints once per release', async () => {
  const dir = tmp();
  const path = join(dir, 'release.json');
  delete process.env.DELEGATE_RELEASE_CHECK;
  const release = await latestRelease(path, async () => ({ latest: '1.0.93', times: { '1.0.93': '2026-11-24T' } }));
  const args = { path, tool: 'grok', command: '/mngr:update grok', release, installed: '1.0.92' };
  assert.match(noticeOnce(args), /grok 1\.0\.93 is out/);
  assert.equal(noticeOnce(args), '');
  assert.equal(noticeOnce({ ...args, installed: '1.0.93' }), '');
  rmSync(dir, { recursive: true });
});

test('papercuts group by key and show recurrence after a fix', () => {
  const dir = tmp();
  const path = join(dir, 'cuts.jsonl');
  appendPapercut(path, { ts: '2026-01-01T00:00:00Z', source: 'detected', key: 'error-detail', text: 'boom' });
  appendPapercut(path, { ts: '2026-01-02T00:00:00Z', source: 'resolution', text: 'fixed', resolves: 'error-detail' });
  assert.equal(formatOpenPapercuts(readPapercuts(path), 'grok'), '');
  appendPapercut(path, { ts: '2026-01-03T00:00:00Z', source: 'detected', key: 'error-detail', text: 'boom' });
  assert.match(formatOpenPapercuts(readPapercuts(path), 'grok'), /Recurred after a recorded fix/);
  rmSync(dir, { recursive: true });
});

test('parseCli drops a leading -- and refuses unknown flags', () => {
  assert.deepEqual(parseCli(['--', '--model', 'x', 'task'], { model: { type: 'string' } }).positionals, ['task']);
  assert.throws(() => parseCli(['--nope'], { model: { type: 'string' } }));
});

test('a quota error with a reset time blocks that model until it passes', async () => {
  const { noteRun, parseResetMs, quotaBlock, readQuota } = await import('./quota.mjs');
  const dir = tmp();
  const path = join(dir, 'quota.json');
  assert.equal(parseResetMs('Individual quota reached. Resets in 3h25m10s.'), (3 * 3600 + 25 * 60 + 10) * 1000);
  const t0 = Date.parse('2026-11-24T00:00:00Z');
  noteRun(path, 'm', 'Individual quota reached. Resets in 1h.', t0);
  assert.ok(quotaBlock(path, 'm', t0 + 1000));
  assert.equal(quotaBlock(path, 'm', t0 + 3_600_001), null);
  assert.equal(quotaBlock(path, 'other', t0), null);
  noteRun(path, 'g', 'API error (status 402 Payment Required): usage balance exhausted', t0);
  assert.equal(quotaBlock(path, 'g', t0), null, 'no reset time: remembered, not blocking');
  noteRun(path, 'm', 'Not signed in', t0);
  assert.ok(readQuota(path).m, 'other errors leave the entry');
  noteRun(path, 'm', undefined, t0);
  assert.equal(readQuota(path).m, undefined, 'a run that got through clears it');
  rmSync(dir, { recursive: true });
});
