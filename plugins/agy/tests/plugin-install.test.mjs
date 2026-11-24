// installPlugin and removeLegacyInstall: the agent and bash tool go in as one agy plugin,
// and what earlier versions wrote into agy's global config comes out.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASH_SERVER, installPlugin, mcpConfigPath, pluginDir, removeLegacyInstall } from '../scripts/lib/agy.mjs';
import { STUB_BIN } from './helpers.mjs';

const agentSource = readFileSync(new URL('../agy-agents/bash-delegate.md', import.meta.url), 'utf8');
const config = () => join(homedir(), '.gemini', 'config');

describe('installPlugin', () => {
  const prevBin = process.env.AGY_BIN;
  beforeAll(() => { process.env.AGY_BIN = STUB_BIN; });
  afterAll(() => {
    if (prevBin === undefined) delete process.env.AGY_BIN;
    else process.env.AGY_BIN = prevBin;
  });

  it('installs when missing, skips when the same, reinstalls when the copy differs', async () => {
    expect(await installPlugin(STUB_BIN)).toBe('installed');
    expect(readFileSync(join(pluginDir(), 'agents', 'bash-delegate.md'), 'utf8')).toBe(agentSource);
    const { mcpServers } = JSON.parse(readFileSync(join(pluginDir(), 'mcp_config.json'), 'utf8'));
    expect(mcpServers[BASH_SERVER].args[0]).toMatch(/\/mcp\/bash\.mjs$/);
    expect(await installPlugin(STUB_BIN)).toBe('unchanged');
    writeFileSync(join(pluginDir(), 'agents', 'bash-delegate.md'), 'stale', 'utf8');
    expect(await installPlugin(STUB_BIN)).toBe('updated');
    expect(readFileSync(join(pluginDir(), 'agents', 'bash-delegate.md'), 'utf8')).toBe(agentSource);
  });

  it('removes the global agent and bash server earlier versions installed', async () => {
    mkdirSync(join(config(), 'agents'), { recursive: true });
    writeFileSync(join(config(), 'agents', 'bash-delegate.md'), 'old', 'utf8');
    writeFileSync(join(config(), 'agents', 'agy-video.md'), 'mine', 'utf8');
    writeFileSync(mcpConfigPath(), JSON.stringify({ mcpServers: { exa: { command: 'npx' }, agy: { command: 'node' }, agybash: {} } }), 'utf8');
    await installPlugin(STUB_BIN);
    expect(existsSync(join(config(), 'agents', 'bash-delegate.md'))).toBe(false);
    expect(existsSync(join(config(), 'agents', 'agy-video.md'))).toBe(true);
    expect(JSON.parse(readFileSync(mcpConfigPath(), 'utf8'))).toEqual({ mcpServers: { exa: { command: 'npx' } } });
  });
});

describe('removeLegacyInstall', () => {
  it('leaves an MCP config without legacy servers untouched, and refuses one that is not JSON', () => {
    const file = join(config(), 'other.json');
    mkdirSync(config(), { recursive: true });
    writeFileSync(file, '{"mcpServers":{"exa":{}}}', 'utf8');
    expect(removeLegacyInstall(file)).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe('{"mcpServers":{"exa":{}}}');
    writeFileSync(file, '{ not json', 'utf8');
    expect(() => removeLegacyInstall(file)).toThrow(/not valid JSON/);
  });
});
