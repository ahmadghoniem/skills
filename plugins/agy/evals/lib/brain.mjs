// agy's own record of a conversation: one JSON object per step in
// `~/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript_full.jsonl`.
// agy appends a step as soon as it finishes, so the file is readable while the
// job runs. A step carries `type` (USER_INPUT, PLANNER_RESPONSE, GENERIC, ...),
// `status` (DONE, ERROR, INVALID, ...), `error`, `tool_calls` with their full
// arguments, and per-turn `input_tokens`/`output_tokens`.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** `AGY_BRAIN_DIR` overrides the location, for tests. */
export function brainDir() {
  return process.env.AGY_BRAIN_DIR || join(homedir(), '.gemini', 'antigravity-cli', 'brain');
}

/**
 * @param {string} conversationId
 */
export function transcriptPath(conversationId) {
  return join(brainDir(), conversationId, '.system_generated', 'logs', 'transcript_full.jsonl');
}

/**
 * The conversation's steps so far. Empty when agy has not written the file
 * yet; a line torn by a write in progress is skipped.
 *
 * @param {string|undefined} conversationId
 * @returns {Record<string, any>[]}
 */
export function readTranscript(conversationId) {
  if (!conversationId) return [];
  let text;
  try {
    text = readFileSync(transcriptPath(conversationId), 'utf8');
  } catch {
    return [];
  }
  const steps = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      steps.push(JSON.parse(line));
    } catch {
      // torn last line
    }
  }
  return steps;
}

/**
 * @typedef {Object} TranscriptSummary
 * @property {number} toolCalls
 * @property {string|undefined} lastTool
 * @property {{tool: string, message: string}[]} toolErrors
 * @property {{input_tokens: number, output_tokens: number, cache_read_tokens: number}} usage
 */

/**
 * Tool calls, the last tool, failed tool steps and token totals. The totals
 * match the `usage` of agy's result event.
 *
 * @param {Record<string, any>[]} steps
 * @returns {TranscriptSummary}
 */
export function summariseTranscript(steps) {
  let toolCalls = 0;
  /** @type {string|undefined} */
  let lastTool;
  // The step after a model turn holds its tool's outcome, so a failure is
  // named after the call that turn made.
  let pendingTool = 'tool';
  /** @type {{tool: string, message: string}[]} */
  const toolErrors = [];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 };
  for (const s of steps) {
    usage.input_tokens += s.input_tokens ?? 0;
    usage.output_tokens += s.output_tokens ?? 0;
    usage.cache_read_tokens += s.cache_read_tokens ?? 0;
    const calls = Array.isArray(s.tool_calls) ? s.tool_calls : [];
    if (s.type === 'PLANNER_RESPONSE') {
      toolCalls += calls.length;
      if (calls.length) lastTool = pendingTool = String(calls.at(-1).name);
      continue;
    }
    if (s.source === 'MODEL' && (s.status === 'ERROR' || s.status === 'INVALID')) {
      toolErrors.push({ tool: pendingTool, message: String(s.error ?? 'failed with no message') });
    }
  }
  return { toolCalls, lastTool, toolErrors, usage };
}
