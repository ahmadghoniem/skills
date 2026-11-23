#!/usr/bin/env node
// `/agy:papercut`: record what agy said got in its way, or close cuts once a fix
// lands. `delegate.mjs` files agy's errors and failed tool calls on its own.
import { installedVersion } from './lib/agy.mjs';
import { pluginVersion } from './lib/papercuts.mjs';
import { papercutsPath } from './lib/paths.mjs';
import { papercutMain } from './lib/shared/papercuts.mjs';
import { runAsScript } from './lib/shared/proc.mjs';

export const main = (argv) =>
  papercutMain(argv, {
    path: papercutsPath(),
    command: '/agy:papercut',
    pluginVersion,
    toolVersion: async () => (await installedVersion()) ?? undefined,
  });

runAsScript(import.meta.url, main);
