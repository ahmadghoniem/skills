#!/usr/bin/env node
import { invokedAsScript, parseCommandArgv } from './lib/args.mjs';
import { allowModels, denyModels, readConfig, setDefaultModel } from './lib/config.mjs';
import { cachedModels, listModels, refreshModelCache } from './lib/opencode.mjs';

const USAGE =
  'Usage: /opencode:models [--refresh] [--allow <id>...] [--deny <id>...] [--default <id>] [--allowed]\n';

/**
 * Collect the ids a `--allow` or `--deny` refers to: the flag's own value,
 * comma-separated if it has commas, plus any bare tokens that followed it.
 *
 * `parseArgv` binds only the first value to a flag and overwrites on repeat,
 * so `--allow a b` leaves `b` in the positionals and `--allow a --allow b`
 * loses `a`. Trailing tokens are therefore swept up here, and the two flags
 * are refused in the same invocation so there is never a question of which
 * one a loose token belongs to.
 *
 * @param {unknown} value
 * @param {string[]} positional
 * @returns {string[]}
 */
export function collectIds(value, positional) {
  if (value === undefined || value === false) return [];
  /** @type {string[]} */
  const ids = [];
  if (typeof value === 'string') ids.push(...value.split(','));
  ids.push(...positional);
  return ids.map((s) => String(s).trim()).filter(Boolean);
}

/**
 * The live list, grouped by provider, with the allowed ones marked.
 *
 * @param {import('./lib/opencode.mjs').ModelInfo[]} models
 * @param {import('./lib/config.mjs').PluginConfig} config
 * @returns {string}
 */
export function renderModels(models, config) {
  const allowed = new Set(config.models);
  /** @type {Map<string, import('./lib/opencode.mjs').ModelInfo[]>} */
  const byProvider = new Map();
  for (const m of models) {
    if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
    byProvider.get(m.provider).push(m);
  }

  const lines = [];
  for (const provider of [...byProvider.keys()].sort()) {
    lines.push(`${provider}:`);
    for (const m of byProvider.get(provider)) {
      const marks = [];
      if (allowed.has(m.id)) marks.push(m.id === config.default ? 'allowed, default' : 'allowed');
      if (m.free) marks.push('free');
      lines.push(`  ${m.id}${marks.length ? `  (${marks.join(', ')})` : ''}`);
    }
    lines.push('');
  }

  lines.push(
    config.models.length === 0
      ? 'Nothing is allowed yet, so /opencode:delegate will refuse to run. Allow one with /opencode:models --allow <id>.'
      : `Allowed: ${config.models.join(', ')}${config.default ? `   ·   default: ${config.default}` : '   ·   no default set'}`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * Warn when an id is not in the live list. This does not block the change —
 * the list can be stale, and a provider may be configured locally in a way
 * `opencode models` does not surface — but a typo caught here is one that
 * does not fail at dispatch time.
 *
 * @param {string[]} ids
 * @param {import('./lib/opencode.mjs').ModelInfo[]|null} models
 * @returns {string[]}
 */
function unknownIds(ids, models) {
  if (!Array.isArray(models) || models.length === 0) return [];
  const known = new Set(models.map((m) => m.id));
  return ids.filter((id) => !known.has(id));
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { positional, flags } = parseCommandArgv(rawArgv, ['refresh', 'help', 'allowed']);

  if (flags['help']) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (flags['allow'] !== undefined && flags['deny'] !== undefined) {
    process.stderr.write('Error: pass --allow or --deny, not both in one command.\n');
    return 2;
  }
  const allow = collectIds(flags['allow'], positional);
  const deny = collectIds(flags['deny'], positional);
  const makeDefault = typeof flags['default'] === 'string' ? flags['default'].trim() : '';

  const mutating = allow.length > 0 || deny.length > 0 || makeDefault.length > 0;

  /** @type {import('./lib/opencode.mjs').ModelInfo[]|null} */
  let models = flags['refresh'] ? null : cachedModels();
  if (models == null || models.length === 0) {
    try {
      models = await refreshModelCache();
    } catch (err) {
      // A mutation should still land when the list cannot be fetched; only a
      // plain listing has nothing left to show.
      if (!mutating) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
      models = [];
    }
  }

  if (!mutating) {
    const config = readConfig();
    if (flags['allowed']) {
      process.stdout.write(
        config.models.length === 0
          ? 'Nothing is allowed yet. Allow one with /opencode:models --allow <id>.\n'
          : `${config.models.map((m) => `${m}${m === config.default ? '  (default)' : ''}`).join('\n')}\n`,
      );
      return 0;
    }
    process.stdout.write(renderModels(models, config));
    return 0;
  }

  /** @type {string[]} */
  const notes = [];
  const strange = unknownIds([...allow, ...(makeDefault ? [makeDefault] : [])], models);
  if (strange.length > 0) {
    notes.push(
      `Not in the live model list, kept anyway: ${strange.join(', ')}. Check the spelling with /opencode:models --refresh.`,
    );
  }

  let config = readConfig();
  if (allow.length > 0) config = allowModels(allow);
  if (deny.length > 0) config = denyModels(deny);
  if (makeDefault) {
    try {
      config = setDefaultModel(makeDefault);
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
  }

  const lines = [];
  if (allow.length > 0) lines.push(`allowed: ${allow.join(', ')}`);
  if (deny.length > 0) lines.push(`removed: ${deny.join(', ')}`);
  lines.push(
    config.models.length === 0
      ? 'allowlist is now empty — /opencode:delegate will refuse to run.'
      : `allowlist: ${config.models.join(', ')}`,
  );
  lines.push(`default: ${config.default ?? '(none)'}`);
  lines.push(...notes);
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`models failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
