import { describe, expect, it } from 'vitest';
import { compareVersions, newerChangelogEntries, parseChangelog } from '../scripts/update.mjs';

const CHANGELOG = `1.2.2:
· Improved the startup warning for deprecated \`unsandboxed\` permission rules.
· Fixed MCP servers bundled inside plugins colliding with each other.

1.2.1:
· Added support for \`excludeDefaultComponents: true\` in custom agent frontmatter.

1.2.0:
· Added the \`remote-control start\` subcommand.
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
