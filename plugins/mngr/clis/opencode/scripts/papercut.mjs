#!/usr/bin/env node
// `/mngr:papercut opencode`: record what opencode said got in its way, or close cuts
// once a fix lands. `delegate.mjs` files opencode's errors on its own.
import { installedVersion } from './lib/opencode.mjs';
import { pluginVersion } from './lib/papercuts.mjs';
import { papercutsPath } from './lib/paths.mjs';
import { papercutMain } from '../../../scripts/lib/shared/papercuts.mjs';
import { runAsScript } from '../../../scripts/lib/shared/proc.mjs';

export const main = (argv) =>
  papercutMain(argv, {
    path: papercutsPath(),
    command: '/mngr:papercut opencode',
    pluginVersion,
    toolVersion: async () => (await installedVersion()) ?? undefined,
  });

runAsScript(import.meta.url, main);
