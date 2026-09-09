import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEvents, parseLine, summariseEvents } from '../scripts/lib/parse.mjs';
import {
  ADD_DIR_WORKS,
  ERROR_BUT_SUCCEEDED,
  PERMISSION_DENIED,
  READ_AND_COMMAND,
} from './helpers.mjs';

function load(path) {
  return parseEvents(readFileSync(path, 'utf8'));
}

describe('parseLine', () => {
  it('drops empty and malformed lines', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   ')).toBeNull();
    expect(parseLine('not json')).toBeNull();
    expect(parseLine('null')).toBeNull();
    expect(parseLine('[1]')).toBeNull();
    expect(parseLine('42')).toBeNull();
  });

  it('keeps an envelope whose payload key repeats the event name', () => {
    const ev = parseLine('{"event":"init","conversation_id":"x","init":{"model":"m"}}');
    expect(ev?.event).toBe('init');
    expect(ev?.init).toEqual({ model: 'm' });
  });

  it('wraps a bare json-format result object as event:result', () => {
    const ev = parseLine(
      '{"conversation_id":"abc","status":"ERROR","response":"hi","error":"nope"}',
    );
    expect(ev?.event).toBe('result');
    expect(ev?.result?.status).toBe('ERROR');
    expect(ev?.result?.response).toBe('hi');
  });
});

describe('summariseEvents — captured runs', () => {
  it('happy path: tools plus run_command with output and no exit code', () => {
    const s = summariseEvents(load(READ_AND_COMMAND));
    expect(s.status).toBe('SUCCESS');
    expect(s.conversationId).toBe('4a9488fe-e156-4848-aab7-f5dce1c218f6');
    expect(s.permissionMode).toBe('always-proceed');
    expect(s.response).toBe('probe\n');
    expect(s.error).toBeNull();
    const events = load(READ_AND_COMMAND);
    const cmd = events.find(
      (e) =>
        e.event === 'step_update' &&
        e.step_update?.tool_name === 'run_command' &&
        e.step_update?.state === 'DONE',
    );
    expect(cmd?.step_update?.tool_info?.output).toBe('probe\r\n');
    expect(cmd?.step_update?.tool_info?.exit_code).toBeUndefined();
    expect(cmd?.step_update?.tool_info?.ExitCode).toBeUndefined();
    expect(cmd?.step_update?.tool_info?.parameters).toEqual({ CommandLine: 'echo probe' });
  });

  it('add-dir write: SUCCESS, always-proceed', () => {
    const s = summariseEvents(load(ADD_DIR_WORKS));
    expect(s.status).toBe('SUCCESS');
    expect(s.permissionMode).toBe('always-proceed');
    expect(s.response).toContain('Created');
  });

  it('permission denied: ERROR, empty response, tool state ERROR', () => {
    const s = summariseEvents(load(PERMISSION_DENIED));
    expect(s.status).toBe('ERROR');
    expect(s.response).toBe('');
    expect(s.permissionMode).toBe('request-review');
    expect(s.error).toMatch(/permission check failed for command "echo SHELLOK"/);
    const events = load(PERMISSION_DENIED);
    const tool = events.find(
      (e) => e.event === 'step_update' && e.step_update?.tool_name === 'run_command',
    );
    const errTool = events.find(
      (e) =>
        e.event === 'step_update' &&
        e.step_update?.tool_name === 'run_command' &&
        e.step_update?.state === 'ERROR',
    );
    expect(tool?.step_update?.tool_info?.parameters).toEqual({ CommandLine: 'echo SHELLOK' });
    expect(errTool?.step_update?.tool_info?.error?.type).toBe('TOOL_ERROR');
    expect(String(errTool?.step_update?.tool_info?.error?.message)).toMatch(
      /permission check failed/,
    );
  });

  it('json format: status ERROR plus a real success in the response', () => {
    const s = summariseEvents(load(ERROR_BUT_SUCCEEDED));
    expect(s.status).toBe('ERROR');
    expect(s.conversationId).toBe('b8b3e36f-3fb0-4d55-a0ee-8a839b4b0fe4');
    expect(s.response).toContain('sidecar-worked.txt');
    expect(s.error).toMatch(/not a valid artifact path/);
  });

  it('does not invent a pass/fail boolean', () => {
    const s = summariseEvents(load(ERROR_BUT_SUCCEEDED));
    expect(s).not.toHaveProperty('success');
    expect(s).not.toHaveProperty('failedCommands');
  });
});

describe('tool errors from step_update', () => {
  it('harvests state:ERROR + tool_info.error from the permission-denied run', () => {
    // This fixture was already committed and already asserted — but only by
    // reaching into the raw events array. The summariser ignored it entirely,
    // so the test proved the data existed and simultaneously proved it was
    // being dropped. Now it goes through summariseEvents.
    const s = summariseEvents(load(PERMISSION_DENIED));
    expect(s.toolErrors).toHaveLength(1);
    expect(s.toolErrors[0].tool).toBe('run_command');
    expect(s.toolErrors[0].message).toMatch(/permission check failed for command "echo SHELLOK"/);
  });

  it('is empty for runs where every tool succeeded', () => {
    expect(summariseEvents(load(READ_AND_COMMAND)).toolErrors).toEqual([]);
    expect(summariseEvents(load(ADD_DIR_WORKS)).toolErrors).toEqual([]);
  });
});

describe('toolCalls', () => {
  it('counts every tool step, not just the ones that failed', () => {
    const events = [
      { event: 'step_update', step_update: { step_type: 'tool', tool_name: 'view_file' } },
      { event: 'step_update', step_update: { step_type: 'tool', tool_name: 'view_file' } },
      {
        event: 'step_update',
        step_update: { step_type: 'tool', tool_name: 'run_command', state: 'ERROR' },
      },
      { event: 'step_update', step_update: { step_type: 'thought' } },
      { event: 'result', result: { status: 'SUCCESS', conversation_id: 'c', response: 'ok' } },
    ];
    const s = summariseEvents(events);
    expect(s.toolCalls).toBe(3);
    expect(s.toolErrors).toHaveLength(1);
  });

  it('is zero for a run that called no tools', () => {
    expect(summariseEvents([]).toolCalls).toBe(0);
  });
});
