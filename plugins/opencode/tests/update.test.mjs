import { describe, expect, it } from 'vitest';
import { compareVersions, installMethod } from '../scripts/update.mjs';

describe('compareVersions', () => {
  it('compares components numerically, not as text', () => {
    expect(compareVersions('1.18.31', '1.18.9')).toBe(1);
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
  });

  it('treats a missing component as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('ignores a leading v', () => {
    expect(compareVersions('v1.18.31', '1.18.31')).toBe(0);
  });

  it('does not throw on junk', () => {
    expect(compareVersions('', 'x.y.z')).toBe(0);
  });
});

describe('installMethod', () => {
  it('recognises a bun global install', () => {
    expect(installMethod('C:\\Users\\x\\.bun\\bin\\opencode.exe')).toBe('bun');
  });

  it('recognises npm and pnpm', () => {
    expect(installMethod('C:/Users/x/AppData/Roaming/npm/opencode.cmd')).toBe('npm');
    expect(installMethod('/home/x/.local/share/pnpm/opencode')).toBe('pnpm');
  });

  it('recognises brew and the Windows package managers', () => {
    expect(installMethod('/opt/homebrew/bin/opencode')).toBe('brew');
    expect(installMethod('C:/Users/x/scoop/shims/opencode.exe')).toBe('scoop');
    expect(installMethod('C:/ProgramData/chocolatey/bin/opencode.exe')).toBe('choco');
  });

  it('returns null rather than guess, so `opencode upgrade` picks for itself', () => {
    expect(installMethod('/usr/local/bin/opencode')).toBeNull();
    expect(installMethod(undefined)).toBeNull();
  });
});
