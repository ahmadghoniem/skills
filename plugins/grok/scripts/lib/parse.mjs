// NDJSON parser for `grok --output-format streaming-json`.
//
// A note on where this shape came from: `grok --help` describes streaming-json
// as "NDJSON of the agent native ACP session updates", which would imply
// `{method:'session/update', params:{…}}` envelopes. Real runs emit nothing of
// the sort — they emit flat `{type, …}` objects. This parser is written against
// what grok 1.0.5 actually produced on a captured run, not against the docs.
//
// Event types observed:
//   available_commands  — startup inventory of tools and slash commands
//   thought             — reasoning delta, `.data` is a string fragment
//   text                — assistant message delta, `.data` is a string fragment
//   tool_call           — a tool is about to run; carries toolName/kind/rawInput
//   tool_call_update    — progress/result for a tool_call, keyed by toolCallId
//   usage               — per-turn token usage
//   end                 — terminal event; sessionId, stopReason, cost, turns
//
// Unknown types are ignored rather than treated as errors, so a grok release
// that adds an event type does not break a run.

/**
 * @typedef {Object<string, unknown>} GrokEvent
 */

/**
 * Parse one NDJSON line. Returns null for blank or malformed lines so the
 * caller can still keep them in the raw log.
 *
 * @param {string} line
 * @returns {GrokEvent|null}
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
 * Short human label for a tool_call event, for live progress output.
 * Returns null for events that are not tool calls.
 *
 * @param {GrokEvent} ev
 * @returns {string|null}
 */
export function describeToolCall(ev) {
  if (ev?.type !== 'tool_call') return null;
  const name = typeof ev.toolName === 'string' ? ev.toolName : 'tool';
  const input = ev.rawInput;
  if (input != null && typeof input === 'object') {
    const path = typeof input.file_path === 'string' ? input.file_path : undefined;
    if (path) return `${name} → ${path}`;
    const command = typeof input.command === 'string' ? input.command : undefined;
    if (command) return `${name}: ${command}`;
  }
  return name;
}

/**
 * Pull every file path a tool_call / tool_call_update reveals.
 *
 * Two sources, deliberately both: `tool_call.rawInput.file_path` is the path as
 * the model asked for it (usually repo-relative), while `tool_call_update`
 * carries `locations[].path` (relative) alongside `content[].type === 'diff'`
 * entries whose `.path` is absolute. Preferring the relative forms keeps the
 * result readable; the absolute diff path is the fallback so an edit is never
 * silently dropped just because grok omitted `locations`.
 *
 * @param {GrokEvent} ev
 * @returns {string[]}
 */
export function toolPaths(ev) {
  /** @type {string[]} */
  const out = [];
  if (ev?.type === 'tool_call') {
    const input = ev.rawInput;
    if (input != null && typeof input === 'object' && typeof input.file_path === 'string') {
      out.push(input.file_path);
    }
    return out;
  }
  if (ev?.type !== 'tool_call_update') return out;
  const locations = Array.isArray(ev.locations) ? ev.locations : [];
  for (const loc of locations) {
    if (loc != null && typeof loc === 'object' && typeof loc.path === 'string') out.push(loc.path);
  }
  if (out.length > 0) return out;
  const content = Array.isArray(ev.content) ? ev.content : [];
  for (const c of content) {
    if (c != null && typeof c === 'object' && c.type === 'diff' && typeof c.path === 'string') {
      out.push(c.path);
    }
  }
  return out;
}

/**
 * Collapse the two spellings of the same file into one.
 *
 * A single edit surfaces twice: `tool_call.rawInput.file_path` gives the
 * repo-relative path the model asked for, and the matching `tool_call_update`
 * gives an absolute one. Listing both makes a one-file change look like a
 * two-file change. An absolute path is dropped when some relative path in the
 * set is a path-segment suffix of it; the relative form is what a reader wants.
 *
 * @param {string[]} paths
 * @returns {string[]}
 */
export function dedupePaths(paths) {
  const unique = [...new Set(paths)];
  const norm = (p) => p.replace(/\\/g, '/');
  const isAbsolute = (p) => /^([a-zA-Z]:\/|\/)/.test(norm(p));
  const relatives = unique.filter((p) => !isAbsolute(p)).map(norm);
  return unique.filter((p) => {
    if (!isAbsolute(p)) return true;
    const n = norm(p);
    return !relatives.some((r) => n === r || n.endsWith(`/${r}`));
  });
}

/**
 * Rewrite paths under `root` as repo-relative, and drop the duplicates that
 * creates. Grok is inconsistent about which form it reports — the same edit can
 * arrive as `greet.js` from one event and an absolute path from another, and
 * some runs only ever produce the absolute one — so normalising against a known
 * root is what makes a file list read like a diff rather than like a log.
 *
 * Paths outside `root` are left absolute: they are genuinely elsewhere, and
 * that is exactly what a reviewer needs to notice.
 *
 * @param {string[]} paths
 * @param {string} [root]
 * @returns {string[]}
 */
export function normalisePaths(paths, root) {
  if (!root) return dedupePaths(paths);
  const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const prefix = `${normRoot}/`;
  const rebased = paths.map((p) => {
    const n = p.replace(/\\/g, '/');
    if (n.toLowerCase().startsWith(prefix.toLowerCase())) return n.slice(prefix.length);
    return p;
  });
  return dedupePaths(rebased);
}

/**
 * @typedef {Object} CommandRun
 * @property {string} command
 * @property {number|null} exitCode
 * @property {string} output
 * @property {boolean} timedOut
 */

/**
 * @typedef {Object} Summary
 * @property {string} summary
 * @property {string[]} filesTouched
 * @property {CommandRun[]} commands
 * @property {CommandRun[]} failedCommands
 * @property {string|undefined} sessionId
 * @property {string|undefined} resolvedModel
 * @property {number|undefined} costUsd
 * @property {number|undefined} numTurns
 * @property {string} stopReason
 * @property {boolean} success
 */

/**
 * Fold a whole run's event stream into the record a job needs.
 *
 * `success` tracks grok's own `stopReason` only. A command exiting non-zero is
 * reported in `failedCommands` but deliberately does NOT flip `success`: a
 * non-zero exit is routinely intentional (`grep` finds nothing, a red test in a
 * TDD cycle, a `command -v` probe), so failing the job on it would cry wolf
 * often enough to be ignored. Surfacing it and letting a human judge is the
 * whole point.
 *
 * @param {GrokEvent[]} events
 * @param {string} [root]   Repo root; absolute paths under it are made relative.
 * @returns {Summary}
 */
export function summariseEvents(events, root) {
  /** @type {Set<string>} */
  const files = new Set();
  /** @type {Map<string, CommandRun>} */
  const commandsById = new Map();
  const textParts = [];
  let sessionId;
  let resolvedModel;
  let costUsd;
  let numTurns;
  let stopReason = 'incomplete';
  let sawEnd = false;
  let toolCallSinceText = false;

  for (const ev of events) {
    if (ev == null || typeof ev !== 'object') continue;
    const type = ev.type;

    if (type === 'text' && typeof ev.data === 'string') {
      // Grok emits one text run per turn with no separator between turns, so
      // consecutive runs concatenate into "…their output.PowerShell stripped…".
      // A tool call is what sits between two turns, so use it as the boundary.
      if (toolCallSinceText && textParts.length > 0) textParts.push('\n\n');
      toolCallSinceText = false;
      textParts.push(ev.data);
      continue;
    }
    if (type === 'tool_call') toolCallSinceText = true;

    if (type === 'tool_call' || type === 'tool_call_update') {
      for (const p of toolPaths(ev)) files.add(p);
    }

    if (type === 'tool_call') {
      const input = ev.rawInput;
      const command =
        input != null && typeof input === 'object' && typeof input.command === 'string'
          ? input.command
          : undefined;
      if (command && typeof ev.toolCallId === 'string') {
        commandsById.set(ev.toolCallId, {
          command,
          exitCode: null,
          output: '',
          timedOut: false,
        });
      }
      continue;
    }

    if (type === 'tool_call_update') {
      const raw = ev.rawOutput;
      // A single tool call emits several updates; only some carry rawOutput.
      // Later ones supersede earlier ones, so the last exit code wins.
      if (raw != null && typeof raw === 'object' && typeof ev.toolCallId === 'string') {
        const existing = commandsById.get(ev.toolCallId);
        const command =
          typeof raw.command === 'string' ? raw.command : (existing?.command ?? '(unknown)');
        commandsById.set(ev.toolCallId, {
          command,
          exitCode: typeof raw.exit_code === 'number' ? raw.exit_code : (existing?.exitCode ?? null),
          output:
            typeof raw.output_for_prompt === 'string' && raw.output_for_prompt.length > 0
              ? raw.output_for_prompt
              : (existing?.output ?? ''),
          timedOut: raw.timed_out === true || existing?.timedOut === true,
        });
      }
      continue;
    }

    if (type === 'end') {
      sawEnd = true;
      if (typeof ev.sessionId === 'string') sessionId = ev.sessionId;
      if (typeof ev.stopReason === 'string') stopReason = ev.stopReason;
      if (typeof ev.total_cost_usd === 'number') costUsd = ev.total_cost_usd;
      if (typeof ev.num_turns === 'number') numTurns = ev.num_turns;
      const usage = ev.modelUsage;
      if (usage != null && typeof usage === 'object') {
        const names = Object.keys(usage);
        if (names.length > 0) resolvedModel = names[0];
      }
    }
  }

  const commands = [...commandsById.values()];
  const summary = textParts.join('').trim();

  return {
    summary: (summary || '(no final message captured)').slice(0, 8000),
    filesTouched: normalisePaths([...files], root),
    commands,
    failedCommands: commands.filter((c) => typeof c.exitCode === 'number' && c.exitCode !== 0),
    sessionId,
    resolvedModel,
    costUsd,
    numTurns,
    stopReason,
    // No `end` event means the stream was truncated — a killed run, a crash, a
    // broken pipe. That is not a success even if everything before it looked fine.
    success: sawEnd && stopReason === 'end_turn',
  };
}
