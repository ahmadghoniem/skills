// Stream-json parser for cursor-agent output.
// Tolerates schema drift: returns the event object verbatim (passthrough).
// Cursor typically emits `tool_use` blocks nested inside `assistant.message.content[]`
// (Anthropic Messages API shape); we walk recursively to find them wherever they live.

/**
 * @typedef {Object<string, unknown>} CursorEvent
 */

/**
 * Parse a single NDJSON line into an event object. Returns null for blank
 * or malformed lines so callers can still preserve them in the raw log.
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

const CHAT_ID_KEYS = ['chat_id', 'chatId', 'session_id', 'sessionId'];

function dig(obj, keys) {
  if (obj == null || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  for (const v of Object.values(obj)) {
    const found = dig(v, keys);
    if (found) return found;
  }
  return undefined;
}

/**
 * @param {CursorEvent[]} events
 * @returns {string|undefined}
 */
export function extractChatId(events) {
  for (const ev of events) {
    const id = dig(ev, CHAT_ID_KEYS);
    if (id) return id;
  }
  return undefined;
}

const MODEL_KEYS = ['model', 'model_id', 'modelId'];

/**
 * Best-effort extraction of the *concrete* model id Cursor actually ran with
 * (as opposed to the alias/`auto` the caller requested). Cursor's stream
 * schema drifts, so this is deliberately loose: any string under `model` /
 * `model_id` / `modelId` anywhere in an event is accepted. Returns undefined
 * when the stream never surfaces one — callers should keep the requested
 * model id in that case, not blank it out.
 *
 * @param {CursorEvent[]} events
 * @returns {string|undefined}
 */
export function extractResolvedModel(events) {
  for (const ev of events) {
    const model = dig(ev, MODEL_KEYS);
    if (model) return model;
  }
  return undefined;
}

// Tool-name substrings that indicate a file was written/modified. Cursor (and
// other agent CLIs) rename these across releases — e.g. `search_replace`,
// `MultiEdit`, `delete_file` — so this list stays intentionally broad rather
// than pinned to one vendor's current naming, matched case-insensitively.
const WRITE_TOOL_HINTS = [
  'write',
  'edit',
  'str_replace',
  'search_replace',
  'create_file',
  'delete_file',
  'multiedit',
  'patch',
  'apply_patch',
  'file_write',
  'insert',
  'rewrite',
];

function looksLikeFileWrite(name) {
  if (typeof name !== 'string') return false;
  const lower = name.toLowerCase();
  return WRITE_TOOL_HINTS.some((h) => lower.includes(h));
}

function pickString(obj, keys) {
  if (obj == null || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

const FILE_PATH_KEYS = ['path', 'file_path', 'filename', 'file', 'target', 'target_file'];

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isFileWriteTool(name) {
  return looksLikeFileWrite(name);
}

/**
 * Extract a file path from a tool_use `input` object, trying every key name
 * the various tool schemas use. Shared by the job summary (`summariseEvents`)
 * and any live progress printer that wants to show "tool → file" instead of
 * a bare tool name.
 *
 * @param {unknown} input
 * @returns {string|undefined}
 */
export function pickToolPath(input) {
  return pickString(input, FILE_PATH_KEYS);
}

/**
 * Extract human-readable text from a value that may be a plain string, an
 * Anthropic-style `content[]` array of `{type:'text', text}` blocks, or an
 * object carrying either under common keys. Returns undefined when empty.
 *
 * @param {unknown} value
 * @returns {string|undefined}
 */
export function pickText(value) {
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (Array.isArray(value)) {
    const parts = [];
    for (const item of value) {
      if (typeof item === 'string') parts.push(item);
      else if (
        item != null &&
        typeof item === 'object' &&
        (item.type === 'text' || item.type === undefined) &&
        typeof item.text === 'string'
      ) {
        parts.push(item.text);
      }
    }
    const joined = parts.join('');
    return joined.length > 0 ? joined : undefined;
  }
  if (value != null && typeof value === 'object') {
    for (const k of ['result', 'text', 'content', 'message']) {
      const t = pickText(value[k]);
      if (t) return t;
    }
  }
  return undefined;
}

/**
 * Yield every tool invocation anywhere in the tree, tolerating the two shapes
 * cursor-agent actually emits:
 *   1. Anthropic-style: `{type:'tool_use', name, input}` (name is a sibling key).
 *   2. cursor-agent native: `{type:'tool_call', tool_call:{<name>ToolCall:{args}}}`
 *      — here the tool NAME is the key inside `tool_call` (e.g. `editToolCall`,
 *      `writeToolCall`) and the arguments live under that object's `.args`.
 * The native shape is what real runs produce; missing it left `filesTouched`
 * empty in practice even though the fixture-shaped unit tests passed.
 *
 * @param {unknown} node
 * @returns {Iterable<{name: string, input: unknown}>}
 */
export function* walkToolUses(node) {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) yield* walkToolUses(item);
    return;
  }
  const type = node.type;
  const name = typeof node.name === 'string' ? node.name : undefined;
  if ((type === 'tool_use' || type === 'tool_call') && name) {
    yield {
      name,
      input: node.input ?? node.arguments ?? node.params ?? node.tool_input,
    };
  }
  // cursor-agent native shape: the tool name is a key inside `tool_call`.
  if (
    type === 'tool_call' &&
    node.tool_call != null &&
    typeof node.tool_call === 'object' &&
    !Array.isArray(node.tool_call)
  ) {
    for (const [toolName, body] of Object.entries(node.tool_call)) {
      if (body != null && typeof body === 'object' && !Array.isArray(body)) {
        yield { name: toolName, input: body.args ?? body.input ?? body };
      }
    }
  }
  for (const v of Object.values(node)) yield* walkToolUses(v);
}

/**
 * @typedef {Object} Summary
 * @property {string} summary
 * @property {string[]} filesTouched
 * @property {string} exitReason
 * @property {boolean} success
 */

/**
 * @param {CursorEvent[]} events
 * @returns {Summary}
 */
export function summariseEvents(events) {
  const files = new Set();
  let finalText;
  let success = true;
  let exitReason = 'completed';

  for (const ev of events) {
    for (const tu of walkToolUses(ev)) {
      if (!looksLikeFileWrite(tu.name)) continue;
      const path = pickToolPath(tu.input);
      if (path) files.add(path);
    }
    const type = ev.type;
    if (type === 'result') {
      const text = pickText(ev) ?? pickText(ev.message);
      if (text) finalText = text;
      const subtype = typeof ev.subtype === 'string' ? ev.subtype : undefined;
      const isError = ev.is_error === true || ev.error != null;
      if (subtype && subtype !== 'success') {
        exitReason = subtype;
        if (subtype.includes('error') || subtype.includes('fail')) success = false;
      }
      if (isError) {
        success = false;
        exitReason = 'error';
      }
    }
  }

  if (!finalText) {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (!ev) continue;
      const type = ev.type;
      if (type === 'assistant' || type === 'message') {
        const text = pickText(ev) ?? pickText(ev.message);
        if (text) {
          finalText = text;
          break;
        }
      }
    }
  }

  const summary = finalText ?? '(no final message captured)';
  return {
    summary: summary.slice(0, 4000),
    filesTouched: [...files],
    exitReason,
    success,
  };
}
