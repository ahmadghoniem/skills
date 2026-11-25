#!/usr/bin/env node
// `/mngr:setup`: `setup.mjs -- [<cli>]` health-checks one CLI, or all of them.
import { dispatch } from './lib/clis.mjs';
import { runAsScript } from './lib/shared/proc.mjs';

/** @param {string[]} argv */
export const main = (argv) => dispatch('setup', argv, { all: true });

runAsScript(import.meta.url, main);
