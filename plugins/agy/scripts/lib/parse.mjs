// NDJSON parser for `agy --output-format stream-json`.
//
// Envelope shape is `{ event: "<name>", "<name>": { ... } }` — the payload
// key repeats the event name. This is not the Claude `{type: ...}` shape.
//
// Closed set of event names observed on agy 1.1.19: `init`, `step_update`,
// `result`. Unknown events are kept but ignored by the summariser.
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

const SCRATCH_RE = /antigravity-cli[\\/]+scratch/i;

/**
 * True when agy's `result.response` claims it created or modified files.
 * Used only to catch the F1 wander (response says it wrote, working tree
 * did not change). Conservative: a `file://` link, or a create/write/modify
 * verb next to something that looks like a filename.
 *
 * @param {string} response
 * @returns {boolean}
 */
export function claimsFileChanges(response) {
  const text = String(response ?? '');
  if (text.length === 0) return false;
  if (/file:\/\//i.test(text)) return true;
  if (/\bcreated the file\b/i.test(text)) return true;
  if (/\bcreated\b/i.test(text) && /\[[^\]]+\]\(/i.test(text)) return true;
  if (/\b(created|wrote|modified|updated)\b/i.test(text) && /\.[a-z0-9]{1,8}\b/i.test(text)) {
    return true;
  }
  return false;
}

/**
 * Pull a filesystem path out of a tool_info.parameters object. PascalCase
 * keys are tool-specific: write_to_file → TargetFile, view_file →
 * AbsolutePath, find_by_name → SearchDirectory.
 *
 * @param {Record<string, unknown>|undefined} params
 * @returns {string[]}
 */
export function toolParamPaths(params) {
  if (params == null || typeof params !== 'object') return [];
  /** @type {string[]} */
  const out = [];
  for (const key of ['TargetFile', 'AbsolutePath', 'SearchDirectory']) {
    const v = params[key];
    if (typeof v === 'string' && v.length > 0) out.push(v);
  }
  return out;
}

/**
 * @typedef {Object} RunSummary
 * @property {string|undefined} conversationId
 * @property {string|undefined} model
 * @property {string|undefined} cwd
 * @property {string|undefined} permissionMode
 * @property {string|null} status
 * @property {string} response
 * @property {string|null} error
 * @property {number|undefined} durationSeconds
 * @property {number|undefined} numTurns
 * @property {unknown} usage
 * @property {string[]} scratchPaths
 * @property {string[]} writeTargets
 * @property {boolean} claimedFileChanges
 */

/**
 * Fold a whole run's event stream into the record a job needs.
 *
 * Does not invent a pass/fail verdict (F5): `status` is agy's own string
 * (or null if no `result` event arrived). Does not invent a per-command
 * exit code — `run_command` never reports one.
 *
 * @param {AgyEvent[]} events
 * @returns {RunSummary}
 */
export function summariseEvents(events) {
  let conversationId;
  let model;
  let cwd;
  let permissionMode;
  /** @type {string|null} */
  let status = null;
  let response = '';
  /** @type {string|null} */
  let error = null;
  /** @type {number|undefined} */
  let durationSeconds;
  /** @type {number|undefined} */
  let numTurns;
  /** @type {unknown} */
  let usage;
  /** @type {string[]} */
  const scratchPaths = [];
  /** @type {string[]} */
  const writeTargets = [];

  for (const ev of events ?? []) {
    if (ev == null || typeof ev !== 'object') continue;
    const kind = ev.event;

    if (kind === 'init') {
      if (typeof ev.conversation_id === 'string') conversationId = ev.conversation_id;
      const init = ev.init;
      if (init != null && typeof init === 'object') {
        if (typeof init.model === 'string') model = init.model;
        if (typeof init.cwd === 'string') cwd = init.cwd;
        if (typeof init.permission_mode === 'string') permissionMode = init.permission_mode;
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
        const info = su.tool_info;
        const params = info != null && typeof info === 'object' ? info.parameters : undefined;
        const paths = toolParamPaths(
          params != null && typeof params === 'object' ? /** @type {Record<string, unknown>} */ (params) : undefined,
        );
        for (const p of paths) {
          if (SCRATCH_RE.test(p)) scratchPaths.push(p);
        }
        if (su.tool_name === 'write_to_file' && typeof params?.TargetFile === 'string') {
          writeTargets.push(params.TargetFile);
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
      if (typeof r.duration_seconds === 'number') durationSeconds = r.duration_seconds;
      if (typeof r.num_turns === 'number') numTurns = r.num_turns;
      if (r.usage != null) usage = r.usage;
    }
  }

  return {
    conversationId,
    model,
    cwd,
    permissionMode,
    status,
    response,
    error,
    durationSeconds,
    numTurns,
    usage,
    scratchPaths,
    writeTargets,
    claimedFileChanges: claimsFileChanges(response),
  };
}
