// The model allowlist, and the default model chosen from it.
//
// This exists because `opencode run` with no `--model` does not fail: on
// 1.18.31 it silently picks one of the 100-odd configured models, which may
// be a metered one. A delegation that quietly bills an account is worse than
// a delegation that refuses to start, so every dispatch here resolves a model
// from an explicit allowlist and stops when it cannot.
//
// The list lives in `~/.cod/config.json`, machine-wide, not in a repository:
// which models you may spend on is a property of your accounts, not of the
// checkout you happen to be standing in.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { configPath } from './paths.mjs';

/**
 * @typedef {Object} PluginConfig
 * @property {string[]} models    Allowed `provider/model` ids, in preference order.
 * @property {string|null} default Default id; must be a member of `models`.
 */

/** @type {PluginConfig} */
const EMPTY = Object.freeze({ models: [], default: null });

/**
 * Read the config, or an empty one when the file is missing or unreadable.
 * Never throws: a corrupt config must degrade to "no models allowed", which
 * blocks a dispatch loudly, rather than to an exception with no explanation.
 *
 * @returns {PluginConfig}
 */
export function readConfig() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath(), 'utf8'));
  } catch {
    return { ...EMPTY };
  }
  if (parsed == null || typeof parsed !== 'object') return { ...EMPTY };
  const models = Array.isArray(parsed.models)
    ? parsed.models.filter((m) => typeof m === 'string' && m.trim()).map((m) => m.trim())
    : [];
  const chosen = typeof parsed.default === 'string' ? parsed.default.trim() : '';
  return {
    models,
    default: chosen && models.includes(chosen) ? chosen : null,
  };
}

/**
 * Overwrite the config.
 *
 * @param {PluginConfig} config
 * @returns {PluginConfig}
 */
export function writeConfig(config) {
  const models = [...new Set((config.models ?? []).map((m) => String(m).trim()).filter(Boolean))];
  const chosen = config.default && models.includes(config.default) ? config.default : null;
  const out = { models, default: chosen };
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  return out;
}

/**
 * Add ids to the allowlist. The first id ever added also becomes the default,
 * so a one-command setup leaves a usable plugin behind.
 *
 * @param {string[]} ids
 * @returns {PluginConfig}
 */
export function allowModels(ids) {
  const config = readConfig();
  const wasEmpty = config.models.length === 0;
  const models = [...config.models];
  for (const id of ids) {
    const trimmed = String(id ?? '').trim();
    if (trimmed && !models.includes(trimmed)) models.push(trimmed);
  }
  const first = ids.map((i) => String(i ?? '').trim()).find(Boolean);
  return writeConfig({
    models,
    default: wasEmpty && first ? first : config.default,
  });
}

/**
 * Remove ids from the allowlist. Removing the default clears it rather than
 * silently promoting another model: which one takes over is the user's call.
 *
 * @param {string[]} ids
 * @returns {PluginConfig}
 */
export function denyModels(ids) {
  const config = readConfig();
  const drop = new Set(ids.map((i) => String(i ?? '').trim()).filter(Boolean));
  const models = config.models.filter((m) => !drop.has(m));
  return writeConfig({
    models,
    default: config.default && drop.has(config.default) ? null : config.default,
  });
}

/**
 * Set the default model. It must already be allowed.
 *
 * @param {string} id
 * @returns {PluginConfig}
 */
export function setDefaultModel(id) {
  const trimmed = String(id ?? '').trim();
  const config = readConfig();
  if (!config.models.includes(trimmed)) {
    throw new Error(
      `${trimmed} is not in the allowlist. Add it first: /opencode:models --allow ${trimmed}`,
    );
  }
  return writeConfig({ models: config.models, default: trimmed });
}

/**
 * @typedef {Object} ModelResolution
 * @property {string|null} model    The id to dispatch with, or null when blocked.
 * @property {string|null} error    Why no model could be resolved.
 */

/**
 * Decide which model a dispatch runs with.
 *
 * An explicit `--model` still has to be on the allowlist: the point of the
 * list is that no path reaches a metered model without the user having put it
 * there, and a typo'd id would otherwise be handed to a CLI that answers it
 * by picking something else.
 *
 * @param {string|undefined} requested
 * @returns {ModelResolution}
 */
export function resolveModel(requested) {
  const config = readConfig();
  const asked = typeof requested === 'string' ? requested.trim() : '';

  if (config.models.length === 0) {
    return {
      model: null,
      error:
        'no models are allowed yet. `opencode run` picks one of your configured models when none is named, which may be a metered one, so this plugin will not dispatch until you say which are fair game: run /opencode:models to see the live list, then /opencode:models --allow <id>.',
    };
  }

  if (asked) {
    if (!config.models.includes(asked)) {
      return {
        model: null,
        error: `${asked} is not in the allowlist (${config.models.join(', ')}). Add it with /opencode:models --allow ${asked}.`,
      };
    }
    return { model: asked, error: null };
  }

  if (config.default) return { model: config.default, error: null };

  if (config.models.length === 1) return { model: config.models[0], error: null };

  return {
    model: null,
    error: `no default model is set. Pass --model <id>, or pick one: /opencode:models --default <id>. Allowed: ${config.models.join(', ')}.`,
  };
}
