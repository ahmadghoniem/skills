// NDJSON parser for `agy --output-format stream-json`.
//
// Envelope shape is `{ event: "<name>", "<name>": { ... } }` — the payload
// key repeats the event name.
//
// `--output-format json` emits the `result` object alone, unwrapped. The
// parser accepts that as a synthetic `result` event.

/**
 * @typedef {Object<string, unknown>} AgyEvent
 */

/**
 * Parse one NDJSON line. Returns null for blank or malformed lines so the
 * caller can still keep them in the raw log.
 *
 * Bare `json` format (a single result object with `status` and
 * `conversation_id`) is wrapped as `{event:'result', result}`.
 *
 * @param {string} line
 * @returns {AgyEvent|null}
 */
export function parseLine(line) {
  const trimmed = String(line ?? '').trim();
  if (trimmed.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (typeof parsed.event === 'string') return parsed;
  if (typeof parsed.status === 'string' && typeof parsed.conversation_id === 'string') {
    return { event: 'result', conversation_id: parsed.conversation_id, result: parsed };
  }
  return parsed;
}

/**
 * Parse a whole stream: NDJSON, or a single JSON document.
 *
 * @param {string} text
 * @returns {AgyEvent[]}
 */
export function parseEvents(text) {
  const raw = String(text ?? '');
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  // A single JSON document (the `json` output format) is one object with no
  // per-line envelopes. Detect it before splitting so pretty-printed JSON
  // still parses.
  if (trimmed.startsWith('{')) {
    const asOne = parseLine(trimmed);
    if (asOne && (asOne.event === 'result' || asOne.event === 'init')) {
      const hasNewlineEnvelope = /\n\s*\{/.test(trimmed);
      if (!hasNewlineEnvelope) return [asOne];
    }
  }
  /** @type {AgyEvent[]} */
  const events = [];
  for (const line of raw.split(/\n/)) {
    const ev = parseLine(line);
    if (ev) events.push(ev);
  }
  return events;
}

/**
 * @typedef {Object} RunSummary
 * @property {string|undefined} conversationId
 * @property {string|undefined} model
 * @property {string|null} status
 * @property {string} response
 * @property {string|null} error
 * @property {string|undefined} finishedReason
 * @property {number} toolCalls
 * @property {{tool: string, message: string}[]} toolErrors
 */

/**
 * The conversation id an event names, if any: `init` and `result` carry it,
 * and so may a `step_update`.
 *
 * @param {AgyEvent} ev
 * @returns {string|undefined}
 */
export function conversationOf(ev) {
  if (ev == null || typeof ev !== 'object') return undefined;
  const id = ev.conversation_id ?? ev.step_update?.conversation_id ?? ev.result?.conversation_id;
  return typeof id === 'string' && id ? id : undefined;
}

/**
 * Fold a whole run's event stream into the record a job needs.
 *
 * Preserves agy's raw status string without inferring pass/fail verdicts.
 * `run_command` never reports a per-command exit code, so the summary does
 * not invent one.
 *
 * @param {AgyEvent[]} events
 * @returns {RunSummary}
 */
export function summariseEvents(events) {
  let conversationId;
  let model;
  /** @type {string|null} */
  let status = null;
  let response = '';
  /** @type {string|null} */
  let error = null;
  // agy says why a turn ended early (`print_timeout`, `interrupted`, `error`)
  // and omits the field when the turn finished normally.
  /** @type {string|undefined} */
  let finishedReason;
  // Total tool steps during the run, successful or failed. agy sends one
  // step_update when a tool starts (ACTIVE) and another when it ends, both with
  // the same step_index, so a step is counted once by its index.
  let toolCalls = 0;
  const toolSteps = new Set();
  /** @type {{tool: string, message: string}[]} */
  const toolErrors = [];

  for (const ev of events ?? []) {
    if (ev == null || typeof ev !== 'object') continue;
    const kind = ev.event;

    if (kind === 'init') {
      if (typeof ev.conversation_id === 'string') conversationId = ev.conversation_id;
      const init = ev.init;
      if (init != null && typeof init === 'object') {
        if (typeof init.model === 'string') model = init.model;
      }
      continue;
    }

    if (kind === 'step_update') {
      const su = ev.step_update;
      if (su == null || typeof su !== 'object') continue;
      if (!conversationId && typeof su.conversation_id === 'string') {
        conversationId = su.conversation_id;
      }
      if (su.step_type === 'tool') {
        if (typeof su.step_index !== 'number') toolCalls += 1;
        else if (!toolSteps.has(su.step_index)) {
          toolSteps.add(su.step_index);
          toolCalls += 1;
        }
        const info = su.tool_info;

        // Record tool failures, including undocumented binary `state: "ERROR"`,
        // to surface failed verification steps during runs marked SUCCESS.
        const err = info != null && typeof info === 'object' ? info.error : undefined;
        if (su.state === 'ERROR' || (err != null && typeof err === 'object')) {
          const message =
            err != null && typeof err === 'object' && typeof err.message === 'string'
              ? err.message
              : 'failed with no message';
          toolErrors.push({
            tool: typeof su.tool_name === 'string' ? su.tool_name : 'tool',
            message,
          });
        }
      }
      continue;
    }

    if (kind === 'result') {
      const r = ev.result != null && typeof ev.result === 'object' ? ev.result : ev;
      if (typeof r.conversation_id === 'string') conversationId = r.conversation_id;
      if (typeof r.status === 'string') status = r.status;
      if (typeof r.response === 'string') response = r.response;
      if (typeof r.error === 'string') error = r.error;
      else if (r.error != null) error = String(r.error);
      if (typeof r.finished_reason === 'string' && r.finished_reason) finishedReason = r.finished_reason;
    }
  }

  return {
    conversationId,
    model,
    status,
    response,
    error,
    finishedReason,
    toolCalls,
    toolErrors,
  };
}
