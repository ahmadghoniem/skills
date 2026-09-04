// Argument parser:
//   - `--foo`                  → flags.foo = true      (if declared boolean)
//   - `--foo value`            → flags.foo = 'value'   (unless declared boolean)
//   - `--foo=value`            → flags.foo = 'value'
//   - `--no-foo`               → flags.foo = false AND flags['foo-kebab'] = false
//   - numeric auto-cast        → `--timeout 60` → flags.timeout === 60
//   - both kebab + camelCase   → flags['git-check'] AND flags.gitCheck populated
//   - positionals              → everything else, in order
//
// `--` delimits flags from positional tokens.

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
    // Backslashes inside single quotes are literal characters.
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
  // Trailing lone backslashes are preserved literally.
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
    // Cast only when the number round-trips without loss of precision.
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
 *   `honorDoubleDash: false` treats `--` as positional text rather than an
 *   end-of-flags delimiter, preserving double dashes in task prompts.
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
    // Bare `--no-foo` negates the flag; `--no-foo=value` preserves its value.
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
    // Consume the next token as value unless missing or another flag.
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
 * Strips the leading `--` delimiter and expands `--arg-string <blob>` via
 * `splitArgString(blob)` to handle unsplit slash-command arguments. Without
 * `--arg-string`, argv is returned unchanged.
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
 * Normalise a `--timeout` flag value to a positive number of seconds, falling
 * back to `fallback` when non-finite or <= 0.
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
 * Determine whether this module is the process entrypoint, resolving symlinks,
 * junctions, and short paths via realpath.
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
