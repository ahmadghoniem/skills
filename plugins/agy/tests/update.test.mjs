import { describe, expect, it } from 'vitest';
import { changesSince, compareVersions, newerChangelogEntries, parseChangelog, updateNotice } from '../scripts/update.mjs';

const CHANGELOG = `1.2.2:
· Improved the startup warning for deprecated \`unsandboxed\` permission rules.
· Fixed MCP servers bundled inside plugins colliding with each other.

1.2.1:
· Added support for \`excludeDefaultComponents: true\` in custom agent frontmatter.

1.2.0:
· Added the \`remote-control start\` subcommand.
`;

const UPSTREAM = `# Antigravity CLI Changelog

## 1.2.11

- Improved reasoning effort level for models with different support.

## 1.2.10

- Added \`medium\` verbosity mode to \`/config\`.

## 1.2.2

- Improved the startup warning.
`;

describe('compareVersions', () => {
  it('treats equal versions as equal', () => {
    expect(compareVersions('1.2.2', '1.2.2')).toBe(0);
  });

  it('orders a one-patch bump', () => {
    expect(compareVersions('1.2.2', '1.2.1')).toBe(1);
    expect(compareVersions('1.2.1', '1.2.2')).toBe(-1);
  });

  it('orders a minor bump', () => {
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1);
  });

  it('sorts 1.2.10 above 1.2.9 numerically, not lexically', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
    expect(compareVersions('1.2.9', '1.2.10')).toBe(-1);
  });
});

describe('parseChangelog', () => {
  it('splits the changelog into version blocks, newest first', () => {
    const blocks = parseChangelog(CHANGELOG);
    expect(blocks.map((b) => b.version)).toEqual(['1.2.2', '1.2.1', '1.2.0']);
    expect(blocks[0].text).toContain('1.2.2:');
    expect(blocks[0].text).toContain('Improved the startup warning');
  });

  it('reads the upstream CHANGELOG.md, whose headers are `## <version>`', () => {
    const blocks = parseChangelog(UPSTREAM);
    expect(blocks.map((b) => b.version)).toEqual(['1.2.11', '1.2.10', '1.2.2']);
    expect(blocks[0].text).toContain('## 1.2.11');
    expect(blocks[0].text).toContain('Improved reasoning effort');
    expect(newerChangelogEntries(UPSTREAM, '1.2.2').map((e) => e.version)).toEqual([
      '1.2.11',
      '1.2.10',
    ]);
  });

  it('returns an empty list for unparseable input', () => {
    expect(parseChangelog('not a changelog, just some prose')).toEqual([]);
    expect(parseChangelog('')).toEqual([]);
  });
});

describe('newerChangelogEntries', () => {
  it('keeps only blocks newer than the recorded version', () => {
    const entries = newerChangelogEntries(CHANGELOG, '1.2.1');
    expect(entries.map((e) => e.version)).toEqual(['1.2.2']);
  });

  it('returns nothing when no version in the changelog is newer', () => {
    const entries = newerChangelogEntries(CHANGELOG, '1.2.2');
    expect(entries).toEqual([]);
  });

  it('returns nothing for a changelog that does not parse', () => {
    const entries = newerChangelogEntries('garbage output, no version headers here', '1.2.1');
    expect(entries).toEqual([]);
  });
});

describe('updateNotice', () => {
  it('names both versions when a newer agy is out', () => {
    const line = updateNotice('1.2.12', '1.2.11');
    expect(line).toContain('agy 1.2.12 is out (installed: 1.2.11)');
    expect(line).toContain('/agy:update');
  });

  it('says nothing when agy is current, newer, or either version is unknown', () => {
    expect(updateNotice('1.2.11', '1.2.11')).toBe('');
    expect(updateNotice('1.2.10', '1.2.11')).toBe('');
    expect(updateNotice(null, '1.2.11')).toBe('');
    expect(updateNotice('1.2.12', null)).toBe('');
  });
});

describe('changesSince', () => {
  const LOCAL = '1.5.14:\n- new\n\n1.5.13:\n- older\n\n1.5.10:\n- base\n';
  const UP = '## 1.5.15\n\n- newest\n\n## 1.5.14\n\n- new\n\n## 1.5.10\n\n- base\n';

  it('uses agy changelog when it lists the new version, without fetching upstream', async () => {
    let fetched = false;
    const r = await changesSince({ since: '1.5.10', newVersion: '1.5.14', local: async () => LOCAL, upstream: async () => { fetched = true; return UP; } });
    expect(r.source).toBe('`agy changelog`');
    expect(r.entries.map((e) => e.version)).toEqual(['1.5.14', '1.5.13']);
    expect(fetched).toBe(false);
  });

  it('falls back to upstream when agy changelog does not list the new version yet', async () => {
    const r = await changesSince({ since: '1.5.10', newVersion: '1.5.15', local: async () => LOCAL, upstream: async () => UP });
    expect(r.source).toMatch(/raw\.githubusercontent/);
    expect(r.entries.map((e) => e.version)).toEqual(['1.5.15', '1.5.14']);
  });

  it('falls back to upstream when agy changelog fails, and to agy when upstream is unreachable', async () => {
    let r = await changesSince({ since: '1.5.10', newVersion: '1.5.14', local: async () => null, upstream: async () => UP });
    expect(r.source).toMatch(/raw\.githubusercontent/);
    r = await changesSince({ since: '1.5.10', newVersion: '1.5.15', local: async () => LOCAL, upstream: async () => null });
    expect(r.source).toBe('`agy changelog`');
    expect(r.entries.map((e) => e.version)).toEqual(['1.5.14', '1.5.13']);
  });
});
