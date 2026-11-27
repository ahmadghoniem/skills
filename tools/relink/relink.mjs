#!/usr/bin/env node
// Keeps this repo's installed plugins live. Claude Code copies an installed
// plugin into ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/ and
// loads that copy, so an edit here would not reach it. Each cache folder is a
// directory junction back into the repo instead (see .claude/CLAUDE.md, "Local
// install on the author's machine").
//
// A version bump or a reinstall quietly breaks that: Claude Code makes a real
// copy under the new version. `npm run relink` puts the junction back under the
// current version, points installed_plugins.json at it, and removes the links
// left under older versions. `check()` reports what is out of line; the root
// `npm test` runs it, so a bump that wasn't relinked turns the tests red.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const isLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};
const real = (path) => {
  try {
    return realpathSync(path).toLowerCase();
  } catch {
    return null;
  }
};

/** The plugin's own manifest: `.claude-plugin/plugin.json` or `plugin.json` at its root. */
function manifest(dir) {
  for (const p of [join(dir, '.claude-plugin', 'plugin.json'), join(dir, 'plugin.json')]) if (existsSync(p)) return readJson(p);
  throw new Error(`no plugin.json in ${dir}`);
}

/**
 * Every plugin the marketplace lists, with where it should be installed and
 * how it is installed now.
 *
 * @param {{repo?: string, claudeHome?: string}} [opts]
 */
export function survey({ repo = REPO, claudeHome = join(homedir(), '.claude') } = {}) {
  const market = readJson(join(repo, '.claude-plugin', 'marketplace.json'));
  const pluginsDir = join(claudeHome, 'plugins');
  const installedPath = join(pluginsDir, 'installed_plugins.json');
  const installed = existsSync(installedPath) ? readJson(installedPath) : { plugins: {} };
  return market.plugins.map((entry) => {
    const target = resolve(repo, entry.source);
    const version = manifest(target).version;
    const key = `${entry.name}@${market.name}`;
    return {
      name: entry.name,
      key,
      version,
      listedVersion: entry.version,
      target,
      folder: join(pluginsDir, 'cache', market.name, entry.name),
      want: join(pluginsDir, 'cache', market.name, entry.name, version),
      installs: installed.plugins?.[key] ?? [],
    };
  });
}

/**
 * What is out of line, one line each; empty when every installed plugin loads
 * from this repo under its current version. Plugins that aren't installed are
 * skipped.
 *
 * @param {{repo?: string, claudeHome?: string}} [opts]
 * @returns {string[]}
 */
export function check(opts) {
  const problems = [];
  for (const p of survey(opts)) {
    if (p.listedVersion && p.listedVersion !== p.version) {
      problems.push(`${p.name}: marketplace.json lists ${p.listedVersion}, its plugin.json says ${p.version}`);
    }
    if (!p.installs.length) continue;
    if (!isLink(p.want) || real(p.want) !== real(p.target)) {
      problems.push(`${p.name}: ${p.want} is not a junction to ${p.target}`);
    }
    for (const i of p.installs) {
      if (resolve(i.installPath) !== resolve(p.want) || i.version !== p.version) {
        problems.push(`${p.name}: installed_plugins.json points at ${i.installPath} (${i.version}), not ${p.want} (${p.version})`);
      }
    }
  }
  return problems;
}

/**
 * Put each installed plugin's junction under its current version, point
 * installed_plugins.json at it, and remove junctions left under other
 * versions. A real folder under an old version is left and reported.
 *
 * @param {{repo?: string, claudeHome?: string, log?: (line: string) => void}} [opts]
 */
export function relink({ log = (line) => process.stdout.write(`${line}\n`), ...opts } = {}) {
  const claudeHome = opts.claudeHome ?? join(homedir(), '.claude');
  const installedPath = join(claudeHome, 'plugins', 'installed_plugins.json');
  const plugins = survey(opts).filter((p) => p.installs.length);
  if (!plugins.length) {
    log('No plugin from this marketplace is installed; nothing to link.');
    return;
  }
  const installed = readJson(installedPath);
  for (const p of plugins) {
    if (isLink(p.want) && real(p.want) === real(p.target)) {
      log(`${p.name} ${p.version}: junction already in place`);
    } else {
      if (isLink(p.want)) unlinkSync(p.want);
      // A real folder here is Claude Code's own copy of the plugin, made by an install or update.
      else if (existsSync(p.want)) rmSync(p.want, { recursive: true, force: true });
      mkdirSync(p.folder, { recursive: true });
      symlinkSync(p.target, p.want, 'junction');
      log(`${p.name} ${p.version}: junction made, ${p.want} -> ${p.target}`);
    }
    for (const i of installed.plugins[p.key]) {
      i.installPath = p.want;
      i.version = p.version;
    }
    for (const old of readdirSync(p.folder)) {
      const path = join(p.folder, old);
      if (old === p.version) continue;
      if (isLink(path)) {
        unlinkSync(path);
        log(`${p.name}: removed the old link ${old}`);
      } else {
        log(`${p.name}: left ${relative(claudeHome, path)}, a real folder, in place`);
      }
    }
  }
  writeFileSync(installedPath, `${JSON.stringify(installed, null, 2)}\n`, 'utf8');
  log('installed_plugins.json updated. Restart Claude Code to load the new paths.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = check();
    for (const line of problems) process.stdout.write(`${line}\n`);
    if (problems.length) process.stdout.write('Run `npm run relink` from the repo root.\n');
    process.exitCode = problems.length ? 1 : 0;
  } else {
    relink();
  }
}
