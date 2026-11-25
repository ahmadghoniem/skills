#!/usr/bin/env node
// `/mngr:papercut`: `papercut.mjs -- <cli> --text ... | --resolve ...` writes to that CLI's papercut log.
import { dispatch } from './lib/clis.mjs';
import { runAsScript } from './lib/shared/proc.mjs';

/** @param {string[]} argv */
export const main = (argv) => dispatch('papercut', argv);

runAsScript(import.meta.url, main);
