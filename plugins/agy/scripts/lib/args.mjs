// Zero-dep replacement for the subset of `yargs-parser` we use.
//
// Handles:
//   - `--foo`                  → flags.foo = true      (if declared boolean)
//   - `--foo value`            → flags.foo = 'value'   (unless declared boolean)
//   - `--foo=value`            → flags.foo = 'value'
//   - `--no-foo`               → flags.foo = false AND flags['foo-kebab'] = false
//   - numeric auto-cast        → `--timeout 60` → flags.timeout === 60
//   - both kebab + camelCase   → flags['git-check'] AND flags.gitCheck populated
//   - positionals              → everything else, in order
//
// `--` is treated as an explicit delimiter: tokens after it are ALL positional
// (no further flag parsing), matching the conventional Unix meaning.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Split a raw argument string on whitespace, honouring single/double quotes
 * and backslash escapes. Quoted spans preserve inner whitespace.
 *
 * @param {string} arg
 * @returns {string[]}
 */
export function splitArgString(arg) {
  const out = [];
  let cur = '';
  /** @type {'"'|"'"|null} */
  let quote = null;
  let escape = false;
  for (let i = 0; i < arg.length; i += 1) {
    const ch = arg[i];
    if (ch === undefined) continue;
    if (escape) {
      cur += ch;
      escape = false;
      continue;
    }
    // Inside single quotes everything is literal: a backslash is NOT an
    // escape character there.
    if (ch === '\\' && quote !== "'") {
      escape = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (cur.length > 0) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  // A trailing lone backslash is a literal backslash, not a dropped escape.
  if (escape) cur += '\\';
  if (cur.length > 0) out.push(cur);
  return out;
}

/**
 * @param {string|undefined} raw
 * @returns {string[]}
 */
export function collapseArguments(raw) {
  if (!raw || raw.trim().length === 0) return [];
  return splitArgString(raw.trim());
}

/**
 * @typedef {Object} ParsedArgs
 * @property {string[]} positional
 * @property {Record<string, unknown>} flags
 */

const kebabToCamel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

function autoCast(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === '') return value;
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    // Only cast when the number round-trips exactly — otherwise a large id
    // like 12345678901234567890 would lose precision and stop matching.
    if (Number.isFinite(n) && String(n) === value) return n;
  }
  return value;
}

/**
 * Parse an argv token stream into flags + positional.
 *
 * @param {string[]} argv
 * @param {string[]} [booleans]   Flag names that NEVER consume the next token.
 * @param {{honorDoubleDash?: boolean}} [opts]
 *   `honorDoubleDash: false` treats `--` as ordinary text instead of an
 *   end-of-flags delimiter. Slash commands use this: their one real delimiter
 *   was already removed by `collapseCommandArgv`, so any `--` still present is
 *   part of the user's task text and must not stop flag parsing.
 * @returns {ParsedArgs}
 */
export function parseArgv(argv, booleans = [], opts = {}) {
  const honorDoubleDash = opts.honorDoubleDash !== false;
  const booleanSet = new Set();
  for (const b of booleans) {
    booleanSet.add(b);
    booleanSet.add(kebabToCamel(b));
  }
  /** @type {Record<string, unknown>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];

  const setFlag = (rawName, value) => {
    flags[rawName] = value;
    const camel = kebabToCamel(rawName);
    if (camel !== rawName) flags[camel] = value;
  };

  let sawDoubleDash = false;
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok === undefined) continue;
    if (sawDoubleDash) {
      positional.push(tok);
      continue;
    }
    if (tok === '--' && honorDoubleDash) {
      sawDoubleDash = true;
      continue;
    }
    if (!tok.startsWith('--')) {
      positional.push(tok);
      continue;
    }
    let rest = tok.slice(2);
    if (rest.length === 0) {
      positional.push(tok);
      continue;
    }
    // --foo=value
    let inlineValue;
    const eq = rest.indexOf('=');
    if (eq !== -1) {
      inlineValue = rest.slice(eq + 1);
      rest = rest.slice(0, eq);
    }
    // --no-foo → negation, but only the bare form: `--no-foo=value` keeps its
    // explicit value rather than being silently discarded.
    let negated = false;
    let name = rest;
    if (name.startsWith('no-') && inlineValue === undefined) {
      negated = true;
      name = name.slice(3);
    }
    if (negated) {
      setFlag(name, false);
      continue;
    }
    if (inlineValue !== undefined) {
      setFlag(name, autoCast(inlineValue));
      continue;
    }
    const camel = kebabToCamel(name);
    const declaredBoolean = booleanSet.has(name) || booleanSet.has(camel);
    if (declaredBoolean) {
      setFlag(name, true);
      continue;
    }
    // Consume next token as value unless it looks like another flag or there
    // is no next token.
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      setFlag(name, true);
      continue;
    }
    i += 1;
    setFlag(name, autoCast(next));
  }
  return { positional, flags };
}

/**
 * Apply the shared slash-command argv prologue.
 *
 * A leading `--` delimiter is stripped (tokens before it are kept verbatim).
 * `--arg-string <blob>` marks `<blob>` as one unsplit string that never passed
 * through a shell — Claude Code's `"$ARGUMENTS"` arrives this way — and is
 * replaced in place by `splitArgString(blob)`. With the marker absent, argv
 * is returned untouched: inferring "needs a split" from token count flattened
 * newlines and collapsed whitespace on a bare one-token prompt.
 *
 * @param {string[]} rawArgv
 * @returns {string[]}
 */
export function collapseCommandArgv(rawArgv) {
  const delimiterIdx = rawArgv.indexOf('--');
  const firstHalf = delimiterIdx === -1 ? [] : rawArgv.slice(0, delimiterIdx);
  const rest = delimiterIdx === -1 ? rawArgv : rawArgv.slice(delimiterIdx + 1);
  const tokens = [...firstHalf, ...rest];
  const markerIdx = tokens.indexOf('--arg-string');
  if (markerIdx === -1) return tokens;
  const blob = tokens[markerIdx + 1];
  const split = blob === undefined ? [] : splitArgString(blob);
  const afterStart = blob === undefined ? markerIdx + 1 : markerIdx + 2;
  return [...tokens.slice(0, markerIdx), ...split, ...tokens.slice(afterStart)];
}

/**
 * Convenience wrapper: collapse the command argv then parse it.
 *
 * @param {string[]} rawArgv
 * @param {string[]} [booleans]
 * @returns {ParsedArgs}
 */
export function parseCommandArgv(rawArgv, booleans = []) {
  return parseArgv(collapseCommandArgv(rawArgv), booleans, { honorDoubleDash: false });
}

/**
 * Normalise a `--timeout` flag value (which may be a number, a numeric string,
 * or junk) into a positive integer number of seconds, falling back to
 * `fallback` for anything non-finite or ≤ 0. Prevents `--timeout abc` → `NaN`
 * silently disabling the watchdog (`NaN > 0` is false, so no timer arms).
 *
 * @param {unknown} raw
 * @param {number} [fallback]
 * @returns {number}
 */
export function parseTimeout(raw, fallback = 900) {
  const n = typeof raw === 'number' ? raw : raw == null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * `process.argv[1] === fileURLToPath(import.meta.url)` breaks under symlinks,
 * Windows junctions, and 8.3 short names. Compare real paths instead.
 *
 * @param {string} moduleUrl    Pass `import.meta.url` from the calling script.
 * @returns {boolean}
 */
export function invokedAsScript(moduleUrl) {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const entryReal = realpathSync(entry);
    const selfReal = realpathSync(fileURLToPath(moduleUrl));
    return entryReal === selfReal;
  } catch {
    return false;
  }
}
