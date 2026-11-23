import { describe, expect, it } from 'vitest';
import { detectedCuts, shortenCut } from '../scripts/lib/papercuts.mjs';

const ctx = { toolVersion: '1.5.14', agyStatus: 'ERROR', exitCode: 1 };

describe('detectedCuts', () => {
  it('files the agy error, and the stderr lines that do not repeat it', () => {
    const anomalies = [
      { id: 'stderr', line: 'agy wrote to stderr:', detail: ['AGY_ERROR: {"x":1}', 'error: quota exhausted', 'dial tcp: timeout'] },
      { id: 'agy-error', line: 'quota exhausted' },
    ];
    const cuts = detectedCuts(anomalies, ctx);
    expect(cuts.map((c) => [c.key, c.text])).toEqual([
      ['agy-error', 'quota exhausted'],
      ['stderr', 'dial tcp: timeout'],
    ]);
  });

  it('writes one cut per failing tool, even though the output no longer shows them', () => {
    const cuts = detectedCuts([], {
      ...ctx,
      toolErrors: [
        { tool: 'view_file', message: 'file does not exist' },
        { tool: 'view_file', message: 'file does not exist' },
        { tool: 'mcp_agy_shell_bash', message: 'exit 1' },
      ],
    });
    expect(cuts.map((c) => [c.key, c.count])).toEqual([
      ['tool-errors:view_file', 2],
      ['tool-errors:mcp_agy_shell_bash', 1],
    ]);
  });

  it('writes nothing for a clean run', () => {
    expect(detectedCuts([], { toolErrors: [] })).toEqual([]);
  });
});

it('drops agy permission wrapper for the review', () => {
  expect(shortenCut('declaring permissions: cortex tool view_file: convert tool call for permissions: path outside workspace')).toBe('path outside workspace');
});
