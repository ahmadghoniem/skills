#!/usr/bin/env node
// `/mngr:update`: `update.mjs -- [<cli>]` updates one CLI, or each in turn.
import { dispatch } from './lib/clis.mjs';
import { runAsScript } from './lib/shared/proc.mjs';

/** @param {string[]} argv */
export const main = (argv) => dispatch('update', argv, { all: true });

runAsScript(import.meta.url, main);
