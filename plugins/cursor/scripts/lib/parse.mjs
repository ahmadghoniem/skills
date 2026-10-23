// NDJSON parser for `cursor-agent -p --output-format stream-json`.
//
// The shapes below are what cursor-agent 2026.10.22-27dcf5f produced on
// captured runs (see `tests/fixtures/cursor-events/`), not what the docs say:
//
//   {"type":"system","subtype":"init","session_id":…,"model":"Auto",…}
//   {"type":"user","message":{…}}
//   {"type":"thinking","subtype":"delta"|"completed",…}
//   {"type":"assistant","message":{"content":[{"type":"text","text":…}]}}
//   {"type":"tool_call","subtype":"started"|"completed","call_id":…,
//    "tool_call":{"shellToolCall":{"args":{…},"result":{"success"|"failure":{…}}}}}
//   {"type":"result","subtype":"success","is_error":false,"result":…,"usage":{…}}
//
// A run refused before the model starts (a model the plan does not allow)
// sends `system` and `user`, then exits 1 with the reason on stderr and no
// `result` event.
//
// Unknown types are ignored rather than treated as errors, so a release that
// adds an event type does not break a run.

/**
 * @typedef {Object<string, unknown>} CursorEvent
 */

/**
 * Parse one NDJSON line. Returns null for blank or malformed lines so the
 * caller can still keep them in the raw log.
 *
 * @param {string} line
 * @returns {CursorEvent|null}
 */
export function parseLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed;
}

/**
 * Guard against an unbounded job record, not a display cap. 256 KB is above
 * anything a run's output budget reaches, and saying so beats cutting quietly.
 */
export const MAX_SUMMARY_CHARS = 256_000;

const CLAIM_VERB = /\b(created|wrote|modified|updated)\b/i;

/** A `file://` link, a local markdown link, `the file`, or a `name.ext` token. */
const FILE_REFERENCE = [/file:\/\//i, /\]\([^)\s]+\)/, /\bthe file\b/i, /\w\.[a-z][a-z0-9]{0,7}\b/i];

/**
 * True when the write-up claims it created or modified files.
 *
 * Used only to catch the case where the write-up says work landed and the
 * working tree disagrees. A false positive costs a warning line on a run that
 * was fine, so one line must hold both a create/write verb and a file
 * reference, with web URLs removed first.
 *
 * @param {string} response
 * @returns {boolean}
 */
export function claimsFileChanges(response) {
  return String(response ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\bhttps?:\/\/\S*/gi, ''))
    .some((line) => CLAIM_VERB.test(line) && FILE_REFERENCE.some((re) => re.test(line)));
}

/**
 * @param {string} text
 * @returns {string}
 */
function capSummary(text) {
  if (text.length <= MAX_SUMMARY_CHARS) return text;
  return `${text.slice(0, MAX_SUMMARY_CHARS)}\n\n[plugin post-flight]\nWrite-up truncated: ${text.length} characters produced, ${MAX_SUMMARY_CHARS} kept. The full text is in this job's \`.ndjson\` log.`;
}

/**
 * The text blocks of an `assistant` event's message, joined.
 *
 * @param {CursorEvent} ev
 * @returns {string}
 */
function messageText(ev) {
  const content = /** @type {any} */ (ev.message)?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
function isObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The tool body of a `tool_call` event: the one key of `tool_call` ending in
 * `ToolCall` (`shellToolCall`, `editToolCall`, `readToolCall`, …). The same
 * object also carries `toolCallId`, timestamps and hook context.
 *
 * @param {CursorEvent} ev
 * @returns {{name: string, body: Record<string, any>}|null}
 */
export function toolBody(ev) {
  const tc = ev?.tool_call;
  if (!isObject(tc)) return null;
  for (const [name, body] of Object.entries(tc)) {
    if (name.endsWith('ToolCall') && isObject(body)) return { name, body };
  }
  return null;
}

/**
 * @typedef {Object} CommandRun
 * @property {string} command
 * @property {number|null} exitCode
 * @property {string} output
 * @property {boolean} timedOut
 */

/**
 * A finished shell command from a `tool_call` `completed` event. Exit 0 is
 * under `result.success`, anything else under `result.failure`; both carry
 * `command`, `exitCode`, `stdout`, `stderr` and `interleavedOutput`, and
 * `failure` also carries `aborted`.
 *
 * @param {CursorEvent} ev
 * @returns {CommandRun|null}
 */
export function shellCommandResult(ev) {
  if (ev?.type !== 'tool_call') return null;
  const tool = toolBody(ev);
  if (!tool || tool.name !== 'shellToolCall') return null;
  const result = tool.body.result;
  if (!isObject(result)) return null;
  const payload = isObject(result.success) ? result.success : isObject(result.failure) ? result.failure : null;
  if (!payload) return null;
  const command =
    typeof payload.command === 'string'
      ? payload.command
      : typeof tool.body.args?.command === 'string'
        ? tool.body.args.command
        : '(unknown)';
  const interleaved = typeof payload.interleavedOutput === 'string' ? payload.interleavedOutput : '';
  const stdout = typeof payload.stdout === 'string' ? payload.stdout : '';
  const stderr = typeof payload.stderr === 'string' ? payload.stderr : '';
  return {
    command,
    exitCode: typeof payload.exitCode === 'number' ? payload.exitCode : null,
    output: interleaved || [stdout, stderr].filter(Boolean).join('\n'),
    timedOut: payload.aborted === true,
  };
}

/**
 * Whether the model has started working: anything past `system` and `user`.
 * A refused run never gets this far, so it is not offered a resume.
 *
 * @param {CursorEvent} ev
 * @returns {boolean}
 */
export function modelStarted(ev) {
  return ev?.type === 'assistant' || ev?.type === 'thinking' || ev?.type === 'tool_call' || ev?.type === 'result';
}

/**
 * @typedef {Object} Summary
 * @property {string} summary
 * @property {CommandRun[]} commands
 * @property {CommandRun[]} failedCommands
 * @property {string|undefined} sessionId
 * @property {string} stopReason
 * @property {string|undefined} errorDetail
 * @property {boolean} success
 * @property {number} toolCalls
 * @property {boolean} claimedFileChanges
 */

/**
 * Fold a whole run's event stream into the record a job needs.
 *
 * `success` tracks the closing `result` event only. A command exiting
 * non-zero is reported in `failedCommands` but does not flip `success`: a
 * non-zero exit is often intended (`grep` finds nothing, a red test in a TDD
 * cycle, a `command -v` probe).
 *
 * @param {CursorEvent[]} events
 * @returns {Summary}
 */
export function summariseEvents(events) {
  /** @type {Map<string, CommandRun>} */
  const commandsById = new Map();
  const callIds = new Set();
  let anon = 0;
  /** @type {string[]} */
  const messages = [];
  let resultText = '';
  let sessionId;
  let stopReason = 'incomplete';
  let errorDetail;

  for (const ev of events) {
    if (!isObject(ev)) continue;
    if (typeof ev.session_id === 'string' && ev.session_id) sessionId = ev.session_id;

    if (ev.type === 'assistant') {
      const text = messageText(ev).trim();
      if (text) messages.push(text);
      continue;
    }

    if (ev.type === 'tool_call') {
      const id = typeof ev.call_id === 'string' ? ev.call_id : `anon-${anon++}`;
      callIds.add(id);
      const cmd = shellCommandResult(ev);
      if (cmd) commandsById.set(id, cmd);
      continue;
    }

    if (ev.type === 'result') {
      resultText = typeof ev.result === 'string' ? ev.result.trim() : '';
      const subtype = typeof ev.subtype === 'string' ? ev.subtype : 'success';
      stopReason = ev.is_error === true && subtype === 'success' ? 'error' : subtype;
      if (ev.is_error === true || subtype !== 'success') {
        errorDetail = resultText || (typeof ev.error === 'string' ? ev.error : undefined);
      }
    }
  }

  // Each `assistant` event is one whole message. The `result` text is the
  // same messages run together with no separator ("…now.Ran …"), so it is
  // used only when no message arrived.
  const summary = messages.length > 0 ? messages.join('\n\n') : resultText;
  const commands = [...commandsById.values()];

  return {
    summary: capSummary(summary),
    toolCalls: callIds.size,
    claimedFileChanges: claimsFileChanges(summary),
    commands,
    failedCommands: commands.filter((c) => typeof c.exitCode === 'number' && c.exitCode !== 0),
    sessionId,
    stopReason,
    errorDetail,
    success: stopReason === 'success',
  };
}
