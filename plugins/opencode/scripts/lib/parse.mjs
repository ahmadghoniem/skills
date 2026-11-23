// NDJSON parser for `opencode run --format json`.
//
// Envelope shape is `{ type: "<name>", timestamp, sessionID, part: { ... } }`.
// Unlike agy there is no terminal `result` event carrying a status string:
// the run's own account of itself is the assistant text, and the closest
// thing to a status is the `reason` on the last `step_finish`.
//
// Event types observed on opencode 1.18.31:
//   step_start   part.type "step-start"
//   tool_use     part.type "tool", part.tool, part.state.{status,output,error}
//   text         part.type "text", part.text
//   step_finish  part.type "step-finish", part.reason, part.tokens, part.cost
//
// `part.state.status` is `completed` even when the command the tool ran
// exited non-zero — a failed `bash` step reports `completed` with the shell's
// error in `output`. Only a tool that could not run at all reports `error`.
// The summariser therefore counts far fewer tool errors than a reader might
// expect, and `contract.md` says so rather than papering over it.

/**
 * @typedef {Object<string, unknown>} OpencodeEvent
 */

/**
 * Parse one NDJSON line. Returns null for blank or malformed lines so the
 * caller can still keep them in the raw log.
 *
 * @param {string} line
 * @returns {OpencodeEvent|null}
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
  return parsed;
}

/**
 * Parse a whole stream of NDJSON.
 *
 * @param {string} text
 * @returns {OpencodeEvent[]}
 */
export function parseEvents(text) {
  const raw = String(text ?? '');
  if (raw.trim().length === 0) return [];
  /** @type {OpencodeEvent[]} */
  const events = [];
  for (const line of raw.split(/\n/)) {
    const ev = parseLine(line);
    if (ev) events.push(ev);
  }
  return events;
}

/**
 * @typedef {Object} TokenTotals
 * @property {number} input
 * @property {number} output
 * @property {number} reasoning
 * @property {number} cacheRead
 * @property {number} cacheWrite
 */

/**
 * @typedef {Object} RunSummary
 * @property {string|undefined} sessionId
 * @property {string} response         Every `text` part, joined.
 * @property {string|null} finishReason Last `step_finish` reason, or null.
 * @property {string|null} error
 * @property {number|undefined} durationSeconds
 * @property {number} steps
 * @property {number} toolCalls
 * @property {string|undefined} lastTool
 * @property {{tool: string, message: string}[]} toolErrors
 * @property {number} costUsd
 * @property {TokenTotals} tokens
 */

/**
 * Pull a human-readable message out of a tool part's error, which opencode
 * may give as a string or as an object with a `message`.
 *
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err != null && typeof err === 'object') {
    const o = /** @type {Record<string, any>} */ (err);
    // A provider error arrives as `{name, data: {message, statusCode, ...}}`,
    // so the readable sentence is nested one level down. Reaching for
    // `err.message` alone falls through to JSON.stringify and prints the whole
    // envelope — Cloudflare headers, NEL report URLs and all — as one 900-char
    // ⚠ line. Look for the message where it actually is, and name the status.
    const nested = o.data != null && typeof o.data === 'object' ? o.data : null;
    const message = [o.message, nested?.message].find(
      (m) => typeof m === 'string' && m.trim(),
    );
    if (message) {
      const status = nested?.statusCode ?? o.statusCode;
      const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : null;
      const prefix = [name, Number.isFinite(status) ? `${status}` : null].filter(Boolean).join(' ');
      return prefix ? `${prefix}: ${message.trim()}` : message.trim();
    }
    try {
      // Nothing readable in it. Keep the shape visible but bounded — the full
      // text is in the job's NDJSON log either way.
      const json = JSON.stringify(err);
      return json.length > 300 ? `${json.slice(0, 300)}… (full text in the job log)` : json;
    } catch {
      return 'failed with no message';
    }
  }
  return 'failed with no message';
}

/**
 * Fold a whole run's event stream into the record a job needs.
 *
 * Costs and token counts are summed across steps. `part.tokens.total` is
 * *not* summed: it already grows across a run in a way that does not equal
 * this step's input plus output, so adding it up would produce a number that
 * means nothing. Only the fields whose per-step meaning is unambiguous are
 * carried.
 *
 * @param {OpencodeEvent[]} events
 * @returns {RunSummary}
 */
export function summariseEvents(events) {
  /** @type {string|undefined} */
  let sessionId;
  /** @type {string[]} */
  const texts = [];
  /** @type {string|null} */
  let finishReason = null;
  /** @type {string|null} */
  let error = null;
  let steps = 0;
  let toolCalls = 0;
  /** @type {string|undefined} */
  let lastTool;
  /** @type {{tool: string, message: string}[]} */
  const toolErrors = [];
  let costUsd = 0;
  const tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  /** @type {number|undefined} */
  let firstTimestamp;
  /** @type {number|undefined} */
  let lastTimestamp;

  for (const ev of events ?? []) {
    if (ev == null || typeof ev !== 'object') continue;

    if (typeof ev.sessionID === 'string' && !sessionId) sessionId = ev.sessionID;
    if (typeof ev.timestamp === 'number') {
      if (firstTimestamp === undefined) firstTimestamp = ev.timestamp;
      lastTimestamp = ev.timestamp;
    }

    const part = ev.part != null && typeof ev.part === 'object' ? ev.part : null;
    if (part && typeof part.sessionID === 'string' && !sessionId) sessionId = part.sessionID;

    switch (ev.type) {
      case 'step_start':
        steps += 1;
        break;

      case 'text':
        if (part && typeof part.text === 'string') texts.push(part.text);
        break;

      case 'tool_use': {
        if (!part) break;
        toolCalls += 1;
        if (typeof part.tool === 'string') lastTool = part.tool;
        const state = part.state != null && typeof part.state === 'object' ? part.state : null;
        if (state && (state.status === 'error' || state.error != null)) {
          toolErrors.push({
            tool: typeof part.tool === 'string' ? part.tool : 'tool',
            message: errorMessage(state.error ?? state.output),
          });
        }
        break;
      }

      case 'step_finish': {
        if (!part) break;
        if (typeof part.reason === 'string') finishReason = part.reason;
        if (typeof part.cost === 'number' && Number.isFinite(part.cost)) costUsd += part.cost;
        const t = part.tokens != null && typeof part.tokens === 'object' ? part.tokens : null;
        if (t) {
          if (typeof t.input === 'number') tokens.input += t.input;
          if (typeof t.output === 'number') tokens.output += t.output;
          if (typeof t.reasoning === 'number') tokens.reasoning += t.reasoning;
          const cache = t.cache != null && typeof t.cache === 'object' ? t.cache : null;
          if (cache) {
            if (typeof cache.read === 'number') tokens.cacheRead += cache.read;
            if (typeof cache.write === 'number') tokens.cacheWrite += cache.write;
          }
        }
        break;
      }

      case 'error': {
        // Not seen on a healthy run; handled so a future or rarer failure
        // envelope reaches the job record instead of being dropped.
        const detail = part ?? ev;
        error = errorMessage(detail.error ?? detail.message ?? detail);
        break;
      }

      default:
        break;
    }
  }

  const durationSeconds =
    typeof firstTimestamp === 'number' && typeof lastTimestamp === 'number'
      ? Math.max(0, Math.round((lastTimestamp - firstTimestamp) / 100) / 10)
      : undefined;

  return {
    sessionId,
    response: texts.join('').trim(),
    finishReason,
    error,
    durationSeconds,
    steps,
    toolCalls,
    lastTool,
    toolErrors,
    costUsd,
    tokens,
  };
}
