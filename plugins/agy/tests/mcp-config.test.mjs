// Unit tests for installBashServer: merging the bash server's entry into agy's
// global MCP config without disturbing the servers already there.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BASH_SERVER, bashServerEntry, installBashServer } from '../scripts/lib/agy.mjs';

let dir;
let file;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cad-mcp-'));
  file = join(dir, 'config', 'mcp_config.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const read = () => JSON.parse(readFileSync(file, 'utf8'));

describe('installBashServer', () => {
  it('creates the config, and its folder, when missing', () => {
    expect(installBashServer(file)).toBe('added');
    expect(read()).toEqual({ mcpServers: { [BASH_SERVER]: bashServerEntry() } });
  });

  it('points at this install\'s bash.mjs with forward slashes', () => {
    const { args, timeoutSeconds, tools } = bashServerEntry();
    expect(args[0]).toMatch(/\/mcp\/bash\.mjs$/);
    expect(args[0]).not.toContain('\\');
    expect(existsSync(args[0])).toBe(true);
    expect(timeoutSeconds).toBe(1260);
    expect(tools).toEqual({ bash: { eager: true } });
  });

  it('keeps other servers and top-level keys', () => {
    installBashServer(file);
    const exa = { command: 'npx', args: ['-y', 'exa-mcp-server'] };
    writeFileSync(file, JSON.stringify({ other: 1, mcpServers: { exa } }), 'utf8');
    expect(installBashServer(file)).toBe('added');
    const cfg = read();
    expect(cfg.other).toBe(1);
    expect(cfg.mcpServers.exa).toEqual(exa);
    expect(cfg.mcpServers[BASH_SERVER]).toEqual(bashServerEntry());
  });

  it('does not rewrite the file when the entry is current', () => {
    installBashServer(file);
    const before = readFileSync(file, 'utf8');
    writeFileSync(file, before.replace(/\n/g, '\r\n'), 'utf8');
    expect(installBashServer(file)).toBe('unchanged');
    expect(readFileSync(file, 'utf8')).toContain('\r\n');
  });

  it('replaces a stale path but keeps extra keys such as env', () => {
    installBashServer(file);
    writeFileSync(
      file,
      JSON.stringify({
        mcpServers: { [BASH_SERVER]: { command: 'node', args: ['C:/old/bash.mjs'], env: { AGY_BASH: 'x' } } },
      }),
      'utf8',
    );
    expect(installBashServer(file)).toBe('updated');
    const entry = read().mcpServers[BASH_SERVER];
    expect(entry.args).toEqual(bashServerEntry().args);
    expect(entry.env).toEqual({ AGY_BASH: 'x' });
  });

  it('renames the legacy agybash entry, keeping its extra keys', () => {
    installBashServer(file);
    const exa = { command: 'npx' };
    writeFileSync(
      file,
      JSON.stringify({
        mcpServers: { exa, agybash: { command: 'node', args: ['C:/old/bash.mjs'], env: { AGY_BASH: 'x' } } },
      }),
      'utf8',
    );
    expect(installBashServer(file)).toBe('updated');
    const servers = read().mcpServers;
    expect(Object.keys(servers)).toEqual(['exa', BASH_SERVER]);
    expect(servers[BASH_SERVER]).toEqual({ ...bashServerEntry(), env: { AGY_BASH: 'x' } });
  });

  it('refuses to overwrite a file that is not valid JSON', () => {
    installBashServer(file);
    writeFileSync(file, '{ "mcpServers": { ', 'utf8');
    expect(() => installBashServer(file)).toThrow(/not valid JSON/);
    expect(readFileSync(file, 'utf8')).toBe('{ "mcpServers": { ');
  });

  it('treats an empty file as an empty config', () => {
    installBashServer(file);
    writeFileSync(file, '', 'utf8');
    expect(installBashServer(file)).toBe('added');
  });
});
