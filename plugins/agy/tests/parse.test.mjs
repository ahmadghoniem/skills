import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEvents, parseLine, summariseEvents } from '../scripts/lib/parse.mjs';
import { ERROR_BUT_SUCCEEDED, PERMISSION_DENIED, READ_AND_COMMAND } from './helpers.mjs';

const load = (path) => parseEvents(readFileSync(path, 'utf8'));

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
    const ev = parseLine('{"conversation_id":"abc","status":"ERROR","response":"hi","error":"nope"}');
    expect(ev?.event).toBe('result');
    expect(ev?.result?.status).toBe('ERROR');
    expect(ev?.result?.response).toBe('hi');
  });
});

describe('summariseEvents on captured runs', () => {
  it('a clean run: status, conversation, report, no error and no tool errors', () => {
    const s = summariseEvents(load(READ_AND_COMMAND));
    expect(s.status).toBe('SUCCESS');
    expect(s.conversationId).toBe('4a9488fe-e156-4848-aab7-f5dce1c218f6');
    expect(s.response).toBe('probe\n');
    expect(s.error).toBeNull();
    expect(s.toolErrors).toEqual([]);
  });

  it('a refused command: ERROR, the reason, and the tool that failed', () => {
    const s = summariseEvents(load(PERMISSION_DENIED));
    expect(s.status).toBe('ERROR');
    expect(s.response).toBe('');
    expect(s.error).toMatch(/permission check failed for command "echo SHELLOK"/);
    expect(s.toolErrors).toHaveLength(1);
    expect(s.toolErrors[0].tool).toBe('run_command');
    expect(s.toolErrors[0].message).toMatch(/permission check failed for command "echo SHELLOK"/);
  });

  it('status ERROR with real work in the response keeps both', () => {
    const s = summariseEvents(load(ERROR_BUT_SUCCEEDED));
    expect(s.status).toBe('ERROR');
    expect(s.conversationId).toBe('b8b3e36f-3fb0-4d55-a0ee-8a839b4b0fe4');
    expect(s.response).toContain('sidecar-worked.txt');
    expect(s.error).toMatch(/not a valid artifact path/);
  });
});

describe('toolCalls', () => {
  it('counts every tool step, failed or not', () => {
    const events = [
      { event: 'step_update', step_update: { step_type: 'tool', tool_name: 'view_file' } },
      { event: 'step_update', step_update: { step_type: 'tool', tool_name: 'view_file' } },
      { event: 'step_update', step_update: { step_type: 'tool', tool_name: 'run_command', state: 'ERROR' } },
      { event: 'step_update', step_update: { step_type: 'thought' } },
      { event: 'result', result: { status: 'SUCCESS', conversation_id: 'c', response: 'ok' } },
    ];
    expect(summariseEvents(events).toolCalls).toBe(3);
  });

  it('counts a tool once across its ACTIVE and DONE updates', () => {
    // find_by_name twice and run_command once, each sent as ACTIVE then DONE.
    expect(summariseEvents(load(READ_AND_COMMAND)).toolCalls).toBe(3);
  });
});
